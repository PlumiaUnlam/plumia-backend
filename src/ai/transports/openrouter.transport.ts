import { AiProviderError } from '../ai-errors';
import { isStrictCompatible, toClosedSchema } from '../ai-schema';
import type {
  EmbeddingTransport,
  LlmJsonRequest,
  LlmTextResult,
  LlmTransport,
  ResolvedLlmStep,
} from '../ai.types';

const BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TOKENS = 16_000;
// Reasoning tokens count against max_tokens; small limits truncate the JSON.
const MIN_MAX_TOKENS = 4_096;

interface ChatCompletionResponse {
  model?: string;
  error?: { code?: number; message?: string };
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
    error?: { code?: number; message?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface EmbeddingResponse {
  error?: { code?: number; message?: string };
  data?: Array<{ index?: number; embedding?: number[] }>;
}

/**
 * OpenRouter (OpenAI-compatible API). Each step targets one model; OpenRouter
 * itself still moves between the providers that host that model.
 */
export class OpenRouterTransport implements LlmTransport, EmbeddingTransport {
  async generate(
    step: ResolvedLlmStep,
    request: LlmJsonRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<LlmTextResult> {
    const schema = request.closedSchema ?? toClosedSchema(request.schema);
    const body = {
      model: step.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: isStrictCompatible(schema),
          schema,
        },
      },
      // Skip hosts that would ignore the JSON schema. Because every parameter
      // becomes mandatory, `temperature` and `reasoning` are not sent: models
      // that do not accept them would be left without any host (HTTP 404).
      provider: { require_parameters: true },
      max_tokens: Math.max(
        request.maxOutputTokens ?? MAX_TOKENS,
        MIN_MAX_TOKENS,
      ),
    };
    const payload = await this.post<ChatCompletionResponse>(
      '/chat/completions',
      step.apiKey,
      body,
      options.signal,
    );
    const choice = payload.choices?.[0];
    const failure = payload.error ?? choice?.error;
    if (failure) {
      throw new AiProviderError(
        failure.code,
        `OpenRouter error: ${failure.message ?? 'unknown'}`,
      );
    }
    if (choice?.finish_reason === 'length') {
      throw new AiProviderError(
        undefined,
        `${request.schemaName} response truncated (length)`,
      );
    }
    const text = choice?.message?.content;
    if (!text) {
      throw new AiProviderError(
        undefined,
        choice?.message?.refusal
          ? `${request.schemaName} refused by ${payload.model ?? step.model}`
          : 'OpenRouter returned no content',
      );
    }
    return {
      text,
      model: payload.model ?? step.model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
  }

  async embed(
    step: { model: string; apiKey: string },
    request: { texts: string[]; dimensions: number },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<number[][]> {
    const payload = await this.post<EmbeddingResponse>(
      '/embeddings',
      step.apiKey,
      {
        model: step.model,
        input: request.texts,
        dimensions: request.dimensions,
      },
      options.signal,
    );
    if (payload.error) {
      throw new AiProviderError(
        payload.error.code,
        `OpenRouter error: ${payload.error.message ?? 'unknown'}`,
      );
    }
    return [...(payload.data ?? [])]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding ?? []);
  }

  private async post<T>(
    path: string,
    apiKey: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } } | null)?.error?.message ??
        raw.slice(0, 300);
      throw new AiProviderError(
        response.status,
        `OpenRouter error ${response.status}: ${message}`,
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new AiProviderError(undefined, 'OpenRouter returned invalid JSON');
    }
    return payload as T;
  }
}
