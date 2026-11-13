import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from '../ai-errors';
import { toClosedSchema } from '../ai-schema';
import type {
  LlmJsonRequest,
  LlmTextResult,
  LlmTransport,
  ResolvedLlmStep,
} from '../ai.types';

const MAX_TOKENS = 16_000;
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
]);

export class AnthropicTransport implements LlmTransport {
  private readonly clients = new Map<string, Anthropic>();

  async generate(
    step: ResolvedLlmStep,
    request: LlmJsonRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<LlmTextResult> {
    const response = await this.client(
      step.apiKey,
      options.timeoutMs,
    ).beta.messages.create(
      {
        model: step.model,
        max_tokens: Math.max(request.maxOutputTokens ?? MAX_TOKENS, 4_096),
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: {
          ...(request.effort ? { effort: request.effort } : {}),
          format: {
            type: 'json_schema',
            schema: request.closedSchema ?? toClosedSchema(request.schema),
          },
        },
        ...(FALLBACK_MODELS.has(step.model)
          ? {
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default' as const,
            }
          : {}),
      },
      { signal: options.signal },
    );

    if (response.stop_reason === 'refusal') {
      throw new AiProviderError(
        undefined,
        `${request.schemaName} refused by ${response.model} (${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError(
        undefined,
        `${request.schemaName} response truncated (max_tokens)`,
      );
    }

    return {
      text: response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join(''),
      model: response.model ?? step.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }

  private client(apiKey: string, timeoutMs: number): Anthropic {
    const cacheKey = `${apiKey}:${timeoutMs}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      // One SDK retry; the router moves to the next step after that.
      client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
      this.clients.set(cacheKey, client);
    }
    return client;
  }
}
