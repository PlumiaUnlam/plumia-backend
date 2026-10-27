import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from './chat-generation.shared';

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_EFFORT = 'low';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
]);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Claude structured outputs require `additionalProperties: false` on every
 * object of the schema.
 */
function toClosedSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(toClosedSchema);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    result[key] = toClosedSchema(value);
  }
  if (result['type'] === 'object') {
    result['additionalProperties'] = false;
  }
  return result;
}

const ANTHROPIC_RESPONSE_SCHEMA = toClosedSchema(RESPONSE_SCHEMA) as Record<
  string,
  unknown
>;

@Injectable()
export class AnthropicChatGenerationAdapter implements ChatGenerationProvider {
  private readonly logger = new Logger(AnthropicChatGenerationAdapter.name);
  private readonly anthropic: Anthropic;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly effort: AnthropicEffort;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ANTHROPIC_API_KEY')?.trim() ?? '';
    const configuredModel = config.get<string>('ANTHROPIC_CHAT_MODEL')?.trim();
    this.model = [configuredModel].find(Boolean) ?? DEFAULT_MODEL;
    const configuredEffort = config
      .get<string>('ANTHROPIC_CHAT_EFFORT')
      ?.trim()
      .toLowerCase();
    this.effort = (
      configuredEffort && EFFORTS.has(configuredEffort)
        ? configuredEffort
        : DEFAULT_EFFORT
    ) as AnthropicEffort;
    const configuredTimeout = Number(
      config.get<string>('ANTHROPIC_CHAT_TIMEOUT_MS'),
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS;
    this.anthropic = new Anthropic({
      apiKey: this.apiKey || null,
      timeout: timeoutMs,
    });
  }

  async generate(input: ChatGenerationInput): Promise<ChatGenerationResult> {
    throwIfAborted(input.signal);
    if (!this.apiKey) {
      this.logger.error(
        'Anthropic chat generation is not configured: ANTHROPIC_API_KEY is empty.',
      );
      throw new ServiceUnavailableException(
        'El servicio de Chat IA no esta configurado.',
      );
    }

    this.logger.log(
      `Anthropic chat generation attempt: model=${this.model} effort=${this.effort} sources=${input.sources.length} history=${input.history.length} questionChars=${input.question.length}`,
    );
    try {
      return await this.generateWithModel(input);
    } catch (error: unknown) {
      if (input.signal?.aborted) {
        throw createAbortError();
      }
      const details = describeProviderError(error);
      this.logger.error(
        `Anthropic chat generation failed: model=${this.model} status=${details.status} code=${details.code} message=${details.message}`,
      );
      throw new ServiceUnavailableException(
        'El servicio de Chat IA no esta disponible temporalmente.',
      );
    }
  }

  private async generateWithModel(
    input: ChatGenerationInput,
  ): Promise<ChatGenerationResult> {
    const response = await this.anthropic.beta.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
        output_config: {
          effort: this.effort,
          format: { type: 'json_schema', schema: ANTHROPIC_RESPONSE_SCHEMA },
        },
        ...(FALLBACK_MODELS.has(this.model)
          ? {
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default' as const,
            }
          : {}),
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    throwIfAborted(input.signal);

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Chat generation refused by ${response.model} (${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Chat generation response truncated (max_tokens)');
    }

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const parsed = parseResponse(text || '{}', 'Anthropic API');
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
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
