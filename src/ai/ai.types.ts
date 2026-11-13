import type { SafetySetting, ThinkingLevel } from '@google/genai';

/** Providers the router can call. Each one is reached with its own API key. */
export const LLM_PROVIDERS = ['anthropic', 'openrouter', 'gemini'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Every LLM use case of the backend. Each one has its own fallback chain. */
export const LLM_USE_CASES = [
  'chat_answer',
  'chat_intent',
  'chat_verify',
  'summary',
  'extraction',
] as const;
export type LlmUseCase = (typeof LLM_USE_CASES)[number];

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Where a credential comes from; failures of a user key never block the server key. */
export type CredentialSource = 'server' | 'user';

/** One attempt of a chain: a provider, a model and (optionally) an explicit key. */
export interface LlmStep {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  credential?: CredentialSource;
}

export interface LlmJsonRequest {
  /** Short name used in logs and as the JSON schema name. */
  schemaName: string;
  system: string;
  user: string;
  /** JSON schema as Gemini accepts it (`responseJsonSchema`). */
  schema: Record<string, unknown>;
  /**
   * Strict variant for Claude and OpenRouter (`additionalProperties: false`,
   * no numeric bounds). Derived from `schema` when omitted.
   */
  closedSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  effort?: ReasoningEffort;
  gemini?: {
    safetySettings?: SafetySetting[];
    thinkingLevel?: ThinkingLevel;
  };
  signal?: AbortSignal;
}

/** Raw provider answer before the use case validates it. */
export interface LlmTextResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmJsonResult<T> {
  value: T;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ResolvedLlmStep {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  credential: CredentialSource;
}

export interface LlmTransport {
  generate(
    step: ResolvedLlmStep,
    request: LlmJsonRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<LlmTextResult>;
}

/** Embedding providers that serve the indexed embedding model. */
export const EMBEDDING_PROVIDERS = ['openrouter', 'gemini'] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export interface EmbeddingStep {
  provider: EmbeddingProviderName;
  model: string;
}

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbeddingTransport {
  embed(
    step: { provider: EmbeddingProviderName; model: string; apiKey: string },
    request: {
      texts: string[];
      dimensions: number;
      taskType?: EmbeddingTaskType;
    },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<number[][]>;
}
