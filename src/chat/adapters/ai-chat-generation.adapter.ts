import { ThinkingLevel } from '@google/genai';
import type {
  HarmBlockThreshold,
  HarmCategory,
  SafetySetting,
} from '@google/genai';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmRouter } from '../../ai/llm-router.service';
import { AiNotConfiguredError, isAbortError } from '../../ai/ai-errors';
import type { LlmJsonRequest, LlmUseCase } from '../../ai/ai.types';
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
  parseClaimVerdicts,
  parseIntentResponse,
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
  parseResponse,
} from './chat-generation.shared';

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
};

/** One verdict per claim, so a single doubtful claim does not drop the rest. */
const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          supported: { type: 'boolean' },
        },
        required: ['index', 'supported'],
      },
    },
  },
  required: ['claims'],
};

/** Only applies when a Gemini step answers; the other providers ignore it. */
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

/**
 * Chat answer, intent routing and evidence verification. Each one has its own
 * fallback chain in the LLM router (Claude first, then OpenRouter, then the
 * Gemini free tier).
 */
@Injectable()
export class AiChatGenerationAdapter
  implements ChatGenerationProvider, ChatIntentProvider, ChatEvidenceVerifier
{
  private readonly logger = new Logger(AiChatGenerationAdapter.name);

  constructor(private readonly router: LlmRouter) {}

  async generate(input: ChatGenerationInput): Promise<ChatGenerationResult> {
    const result = await this.run(
      'chat_answer',
      {
        schemaName: 'chat_answer',
        system: SYSTEM_INSTRUCTION,
        user: buildUserPrompt(input),
        schema: RESPONSE_SCHEMA,
        gemini: { safetySettings: SAFETY_SETTINGS },
        ...(input.signal ? { signal: input.signal } : {}),
      },
      (text) => parseResponse(text, 'AI provider'),
    );
    const parsed = result.value;
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
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  async classify(input: ChatIntentInput): Promise<ChatIntentResult> {
    const result = await this.run(
      'chat_intent',
      {
        schemaName: 'chat_intent',
        system: INTENT_SYSTEM_INSTRUCTION,
        user: JSON.stringify({
          question: input.question,
          history: input.history.slice(-6).map((entry) => ({
            role: entry.role,
            content: entry.content.slice(0, 1_000),
          })),
          helpHint: input.helpHint,
          ...(input.workContext ? { workContext: input.workContext } : {}),
        }),
        schema: INTENT_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1_024,
        gemini: {
          safetySettings: SAFETY_SETTINGS,
          thinkingLevel: ThinkingLevel.LOW,
        },
        ...(input.signal ? { signal: input.signal } : {}),
      },
      parseIntentResponse,
    );
    return {
      ...result.value,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  async verify(
    input: ChatEvidenceVerificationInput,
  ): Promise<ChatEvidenceVerificationResult> {
    const sourceById = new Map(
      input.sources.map((source) => [source.id, source]),
    );
    const result = await this.run(
      'chat_verify',
      {
        schemaName: 'chat_verify',
        system: VERIFICATION_SYSTEM_INSTRUCTION,
        user: JSON.stringify({
          question: input.question,
          workQuestionType: input.workQuestionType ?? 'general',
          claims: input.claims.map((claim, index) => ({
            index,
            text: claim.text,
            evidence: claim.evidence.map((item) => ({
              quote: item.quote,
              sourceKind: sourceById.get(item.sourceId)?.kind ?? 'unknown',
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
        schema: VERIFICATION_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1_024,
        gemini: {
          safetySettings: SAFETY_SETTINGS,
          thinkingLevel: ThinkingLevel.LOW,
        },
        ...(input.signal ? { signal: input.signal } : {}),
      },
      (text) => parseClaimVerdicts(text, input.claims.length),
    );
    return {
      ...result.value,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  /** Maps router errors to the sanitized messages the chat already shows. */
  private async run<T>(
    useCase: LlmUseCase,
    request: LlmJsonRequest,
    parse: (text: string) => T,
  ): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    try {
      return await this.router.generateJson({ useCase, request, parse });
    } catch (error: unknown) {
      if (request.signal?.aborted || isAbortError(error)) {
        throw createAbortError();
      }
      if (error instanceof AiNotConfiguredError) {
        this.logger.error(`Chat ${useCase} has no AI provider configured.`);
        throw new ServiceUnavailableException(
          'El servicio de Chat IA no esta configurado.',
        );
      }
      throw new ServiceUnavailableException(
        'El servicio de Chat IA no esta disponible temporalmente.',
      );
    }
  }
}
