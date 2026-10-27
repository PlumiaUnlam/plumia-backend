import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HarmBlockThreshold,
  HarmCategory,
  SafetySetting,
} from '@google/genai';
import type {
  ChatGenerationInput,
  ChatGenerationProvider,
  ChatGenerationResult,
} from '../ports/chat-generation-provider.port';
import type {
  ChatIntentInput,
  ChatIntentProvider,
  ChatIntentResult,
} from '../ports/chat-intent-provider.port';
import type {
  ChatEvidenceVerificationInput,
  ChatEvidenceVerificationResult,
  ChatEvidenceVerifier,
} from '../ports/chat-evidence-verifier.port';
import {
  parseIntentResponse,
  parseVerificationResponse,
} from './gemini-chat-decision-parser';
import {
  INTENT_SYSTEM_INSTRUCTION,
  VERIFICATION_SYSTEM_INSTRUCTION,
} from './gemini-chat-prompts';
import { WORK_QUESTION_TYPES } from '../domain/work-question-type';
import {
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  createAbortError,
  describeProviderError,
  parseResponse,
  throwIfAborted,
  toRecord,
} from './chat-generation.shared';

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_TIMEOUT_MS = 45_000;
const RETIRED_MODELS = new Set(['gemini-2.5-flash', 'models/gemini-2.5-flash']);
const FALLBACK_STATUS_CODES = new Set([403, 404, 408, 429, 500, 502, 503, 504]);

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'work',
        'application_help',
        'out_of_scope',
        'clarify',
        'unsafe',
        'creative',
      ],
    },
    workQuestionType: { type: 'string', enum: [...WORK_QUESTION_TYPES] },
  },
  required: ['intent', 'workQuestionType'],
} as const;

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: { supported: { type: 'boolean' } },
  required: ['supported'],
} as const;

const SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: 'HARM_CATEGORY_HATE_SPEECH' as HarmCategory,
    threshold: 'BLOCK_MEDIUM_AND_ABOVE' as HarmBlockThreshold,
  },
  {
    category: 'HARM_CATEGORY_HARASSMENT' as HarmCategory,
    threshold: 'BLOCK_MEDIUM_AND_ABOVE' as HarmBlockThreshold,
  },
];

@Injectable()
export class GeminiChatGenerationAdapter
  implements ChatGenerationProvider, ChatIntentProvider, ChatEvidenceVerifier
{
  private readonly logger = new Logger(GeminiChatGenerationAdapter.name);
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;
  private readonly models: string[];

  constructor(config: ConfigService) {
    const dedicatedApiKey = config.get<string>('GEMINI_CHAT_API_KEY')?.trim();
    const sharedApiKey = config.get<string>('GEMINI_API_KEY')?.trim();
    this.apiKey = [dedicatedApiKey, sharedApiKey].find(Boolean) ?? '';

    const configuredPrimaryModel = config
      .get<string>('GEMINI_CHAT_MODEL')
      ?.trim();
    const primaryModel = configuredPrimaryModel ?? DEFAULT_MODEL;
    const configuredModels = config.get<string>('GEMINI_CHAT_MODELS')?.trim();
    const modelList = configuredModels
      ? `${configuredModels},${DEFAULT_MODEL}`
      : `${primaryModel},${DEFAULT_MODEL}`;
    this.models = modelList
      .split(',')
      .map((model) => model.trim())
      .filter(
        (model, index, models) =>
          model.length > 0 &&
          !RETIRED_MODELS.has(model) &&
          models.indexOf(model) === index,
      );
    const configuredTimeout = Number(
      config.get<string>('GEMINI_CHAT_TIMEOUT_MS'),
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS;
    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: timeoutMs },
    });
  }

  async generate(input: ChatGenerationInput): Promise<ChatGenerationResult> {
    return this.withModelFallback('generation', input.signal, (model) =>
      this.generateWithModel(model, input),
    );
  }

  async classify(input: ChatIntentInput): Promise<ChatIntentResult> {
    return this.withModelFallback('routing', input.signal, (model) =>
      this.classifyWithModel(model, input),
    );
  }

  async verify(
    input: ChatEvidenceVerificationInput,
  ): Promise<ChatEvidenceVerificationResult> {
    return this.withModelFallback('verification', input.signal, (model) =>
      this.verifyWithModel(model, input),
    );
  }

  private async withModelFallback<T>(
    operation: string,
    signal: AbortSignal | undefined,
    run: (model: string) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    if (!this.apiKey) {
      this.logger.error(`Gemini chat ${operation} has no API key.`);
      throw new ServiceUnavailableException(
        'El servicio de Chat IA no esta configurado.',
      );
    }
    for (const [index, model] of this.models.entries()) {
      throwIfAborted(signal);
      try {
        return await run(model);
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw createAbortError();
        }
        const retryable = shouldTryFallback(error);
        const details = describeProviderError(error);
        this.logger.error(
          `Gemini chat ${operation} failed: model=${model} status=${details.status} code=${details.code} retryable=${retryable} message=${details.message}`,
        );
        if (!retryable || index === this.models.length - 1) {
          break;
        }
      }
    }
    throw new ServiceUnavailableException(
      'El servicio de Chat IA no esta disponible temporalmente.',
    );
  }

  private async classifyWithModel(
    model: string,
    input: ChatIntentInput,
  ): Promise<ChatIntentResult> {
    const response = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                question: input.question,
                history: input.history.slice(-6).map((entry) => ({
                  role: entry.role,
                  content: entry.content.slice(0, 1_000),
                })),
                helpHint: input.helpHint,
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: INTENT_SYSTEM_INSTRUCTION,
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseJsonSchema: INTENT_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1_024,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...(input.signal ? { abortSignal: input.signal } : {}),
      },
    });
    throwIfAborted(input.signal);
    return {
      ...parseIntentResponse(response.text ?? '{}'),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private async generateWithModel(
    model: string,
    input: ChatGenerationInput,
  ): Promise<ChatGenerationResult> {
    const response = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: buildUserPrompt(input) }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        ...(input.signal ? { abortSignal: input.signal } : {}),
      },
    });

    throwIfAborted(input.signal);

    const parsed = parseResponse(response.text ?? '{}', 'Gemini API');
    return {
      answer: parsed.claims.map((claim) => claim.text).join('\n'),
      sourceIds: [
        ...new Set(
          parsed.claims.flatMap((claim) =>
            claim.evidence.map((evidence) => evidence.sourceId),
          ),
        ),
      ],
      claims: parsed.claims,
      ...(parsed.outOfScope ? { outOfScope: true } : {}),
      ...(parsed.sourceMismatch ? { sourceMismatch: true } : {}),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private async verifyWithModel(
    model: string,
    input: ChatEvidenceVerificationInput,
  ): Promise<ChatEvidenceVerificationResult> {
    const sourceById = new Map(
      input.sources.map((source) => [source.id, source]),
    );
    const response = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                question: input.question,
                workQuestionType: input.workQuestionType ?? 'general',
                claims: input.claims.map((claim) => ({
                  text: claim.text,
                  evidence: claim.evidence.map((item) => ({
                    quote: item.quote,
                    sourceKind:
                      sourceById.get(item.sourceId)?.kind ?? 'unknown',
                  })),
                })),
                sources: input.sources.map((source) => ({
                  id: source.id,
                  kind: source.kind,
                  label: source.label,
                  ...(source.chapterTitle
                    ? { chapterTitle: source.chapterTitle }
                    : {}),
                  excerpt: source.excerpt,
                })),
                openConflicts: input.openConflicts ?? [],
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: VERIFICATION_SYSTEM_INSTRUCTION,
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: 'application/json',
        responseJsonSchema: VERIFICATION_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1_024,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...(input.signal ? { abortSignal: input.signal } : {}),
      },
    });
    throwIfAborted(input.signal);
    return {
      supported: parseVerificationResponse(response.text ?? '{}'),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

function shouldTryFallback(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = toRecord(error)?.['status'];
  return typeof status === 'number' && FALLBACK_STATUS_CODES.has(status);
}
