import { GoogleGenAI } from '@google/genai';
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
export class GeminiChatGenerationAdapter implements ChatGenerationProvider {
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
    throwIfAborted(input.signal);
    if (!this.apiKey) {
      this.logger.error(
        'Gemini chat generation is not configured: no API key was found.',
      );
      throw new ServiceUnavailableException(
        'El servicio de Chat IA no esta configurado.',
      );
    }

    if (this.models.length === 0) {
      this.logger.error(
        'Gemini chat generation has no usable models configured.',
      );
    }

    for (const [index, model] of this.models.entries()) {
      throwIfAborted(input.signal);
      this.logger.log(
        `Gemini chat generation attempt: model=${model} sources=${input.sources.length} history=${input.history.length} questionChars=${input.question.length}`,
      );
      try {
        return await this.generateWithModel(model, input);
      } catch (error: unknown) {
        if (input.signal?.aborted) {
          throw createAbortError();
        }
        const retryable = shouldTryFallback(error);
        const details = describeProviderError(error);
        this.logger.error(
          `Gemini chat generation failed: model=${model} status=${details.status} code=${details.code} retryable=${retryable} message=${details.message}`,
        );
        if (!retryable || index === this.models.length - 1) {
          break;
        }
        this.logger.warn(
          `Gemini chat generation will try the next model after failure: currentModel=${model}`,
        );
      }
    }
    this.logger.error(
      `Gemini chat generation exhausted all models: models=${this.models.join(',') || '(none)'}`,
    );
    throw new ServiceUnavailableException(
      'El servicio de Chat IA no esta disponible temporalmente.',
    );
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
