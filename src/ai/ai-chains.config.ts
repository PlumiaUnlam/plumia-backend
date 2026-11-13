import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDERS,
  LLM_PROVIDERS,
  type EmbeddingProviderName,
  type EmbeddingStep,
  type LlmProvider,
  type LlmStep,
  type LlmUseCase,
  type ReasoningEffort,
} from './ai.types';

/*
 * Fallback order for every use case. Rules:
 * - Claude (Anthropic API) goes first wherever the provider does not matter.
 * - OpenRouter follows with models from other labs, so an outage of one
 *   provider is covered by another one, and ends with `openrouter/free`.
 * - The Gemini API key (free tier) is the last resort.
 * Every step can be replaced with AI_<USE_CASE>_CHAIN="provider:model,...".
 * OpenRouter ids were checked against /api/v1/models with JSON-schema output.
 */
export const DEFAULT_LLM_CHAINS: Record<LlmUseCase, string> = {
  chat_answer: [
    'anthropic:claude-sonnet-5-5',
    'openrouter:anthropic/claude-sonnet-5.5',
    'openrouter:openai/gpt-6.1-sol',
    'openrouter:google/gemini-3.8-flash',
    'openrouter:deepseek/deepseek-v4-pro',
    'openrouter:openrouter/free',
    'gemini:gemini-3.6-flash',
    'gemini:gemini-3.1-flash-lite',
    'gemini:gemini-3.5-flash',
    'gemini:gemini-3.8-flash',
  ].join(','),
  chat_intent: [
    'anthropic:claude-haiku-5-5',
    'openrouter:anthropic/claude-haiku-5.5',
    'openrouter:google/gemini-3.6-flash',
    'openrouter:openai/gpt-5.4-mini',
    'openrouter:deepseek/deepseek-v4-flash',
    'openrouter:openrouter/free',
    'gemini:gemini-3.6-flash',
    'gemini:gemini-3.5-flash-lite',
    'gemini:gemini-3.1-flash-lite',
  ].join(','),
  chat_verify: [
    'anthropic:claude-haiku-5-5',
    'openrouter:anthropic/claude-haiku-5.5',
    'openrouter:google/gemini-3.6-flash',
    'openrouter:openai/gpt-5.4-mini',
    'openrouter:deepseek/deepseek-v4-flash',
    'openrouter:openrouter/free',
    'gemini:gemini-3.6-flash',
    'gemini:gemini-3.5-flash-lite',
    'gemini:gemini-3.1-flash-lite',
  ].join(','),
  summary: [
    'anthropic:claude-haiku-5-5',
    'openrouter:anthropic/claude-haiku-5.5',
    'openrouter:google/gemini-3.1-flash-lite',
    'openrouter:openai/gpt-5.4-mini',
    'openrouter:mistralai/mistral-small-2603',
    'openrouter:deepseek/deepseek-v4-flash',
    'openrouter:openrouter/free',
    'gemini:gemini-3.1-flash-lite',
    'gemini:gemini-3.5-flash',
  ].join(','),
  extraction: [
    'anthropic:claude-sonnet-5-5',
    'openrouter:anthropic/claude-sonnet-5.5',
    'openrouter:openai/gpt-6.1-sol',
    'openrouter:google/gemini-3.6-flash',
    'openrouter:deepseek/deepseek-v4-pro',
    'openrouter:openrouter/free',
    'gemini:gemini-3.6-flash',
    'gemini:gemini-3.1-flash-lite',
    'gemini:gemini-3.8-flash',
  ].join(','),
};

const ENV_PREFIX: Record<LlmUseCase, string> = {
  chat_answer: 'AI_CHAT_ANSWER',
  chat_intent: 'AI_CHAT_INTENT',
  chat_verify: 'AI_CHAT_VERIFY',
  summary: 'AI_SUMMARY',
  extraction: 'AI_EXTRACTION',
};

interface UseCaseDefaults {
  stepTimeoutMs: number;
  totalTimeoutMs: number;
  effort: ReasoningEffort;
}

const USE_CASE_DEFAULTS: Record<LlmUseCase, UseCaseDefaults> = {
  chat_answer: { stepTimeoutMs: 30_000, totalTimeoutMs: 90_000, effort: 'low' },
  chat_intent: { stepTimeoutMs: 15_000, totalTimeoutMs: 40_000, effort: 'low' },
  chat_verify: { stepTimeoutMs: 15_000, totalTimeoutMs: 40_000, effort: 'low' },
  summary: { stepTimeoutMs: 60_000, totalTimeoutMs: 240_000, effort: 'low' },
  extraction: {
    stepTimeoutMs: 120_000,
    totalTimeoutMs: 420_000,
    effort: 'medium',
  },
};

const EFFORTS = new Set<ReasoningEffort>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export interface UseCaseSettings {
  steps: LlmStep[];
  stepTimeoutMs: number;
  totalTimeoutMs: number;
  effort: ReasoningEffort;
}

const logger = new Logger('AiChains');

export function loadUseCaseSettings(
  config: ConfigService,
  useCase: LlmUseCase,
): UseCaseSettings {
  const prefix = ENV_PREFIX[useCase];
  const defaults = USE_CASE_DEFAULTS[useCase];
  const chain =
    readString(config, `${prefix}_CHAIN`) ?? DEFAULT_LLM_CHAINS[useCase];
  // The extraction keeps its historical variables as a fallback.
  const legacyTimeout =
    useCase === 'extraction'
      ? readPositiveNumber(config, 'ENTITY_EXTRACTION_TIMEOUT_MS')
      : undefined;
  const legacyEffort =
    useCase === 'extraction'
      ? readString(config, 'ENTITY_EXTRACTION_EFFORT')
      : undefined;
  const effort = (
    readString(config, `${prefix}_EFFORT`) ??
    legacyEffort ??
    defaults.effort
  ).toLowerCase() as ReasoningEffort;

  return {
    steps: parseLlmChain(chain, prefix),
    stepTimeoutMs:
      readPositiveNumber(config, `${prefix}_STEP_TIMEOUT_MS`) ??
      legacyTimeout ??
      defaults.stepTimeoutMs,
    totalTimeoutMs:
      readPositiveNumber(config, `${prefix}_TOTAL_TIMEOUT_MS`) ??
      defaults.totalTimeoutMs,
    effort: EFFORTS.has(effort) ? effort : defaults.effort,
  };
}

export function parseLlmChain(value: string, source = 'chain'): LlmStep[] {
  return parseEntries(value, source, LLM_PROVIDERS).map(
    ([provider, model]) => ({ provider, model }),
  );
}

/** Server-side key for a provider. Gemini is the free-tier key. */
export function serverApiKey(
  config: ConfigService,
  provider: LlmProvider,
): string {
  switch (provider) {
    case 'anthropic':
      return readString(config, 'ANTHROPIC_API_KEY') ?? '';
    case 'openrouter':
      return readString(config, 'OPENROUTER_API_KEY') ?? '';
    case 'gemini':
      return readString(config, 'GEMINI_API_KEY') ?? '';
  }
}

/*
 * Embeddings cannot fall back to another model: the index only matches
 * vectors of the same model. These four routes return the same vectors as the
 * ones already stored (`gemini-embedding-2`, 1536 dims; cosine 1.000000 in a
 * parity check against the Gemini API), so any of them can serve a request
 * without reindexing. Only add routes that pass that check.
 */
export const EMBEDDING_SPACE = 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 1_536;
export const DEFAULT_EMBEDDING_CHAIN = [
  'openrouter:google/gemini-embedding-2',
  'openrouter:google/gemini-embedding-2-preview',
  'gemini:gemini-embedding-2',
  'gemini:gemini-embedding-2-preview',
].join(',');

export interface EmbeddingSettings {
  steps: EmbeddingStep[];
  stepTimeoutMs: number;
}

export function loadEmbeddingSettings(
  config: ConfigService,
): EmbeddingSettings {
  const chain =
    readString(config, 'AI_EMBEDDING_CHAIN') ?? DEFAULT_EMBEDDING_CHAIN;
  return {
    steps: parseEntries(chain, 'AI_EMBEDDING', EMBEDDING_PROVIDERS).map(
      ([provider, model]) => ({ provider, model }),
    ),
    stepTimeoutMs:
      readPositiveNumber(config, 'AI_EMBEDDING_STEP_TIMEOUT_MS') ?? 20_000,
  };
}

export function embeddingApiKey(
  config: ConfigService,
  provider: EmbeddingProviderName,
): string {
  return serverApiKey(config, provider);
}

function parseEntries<P extends string>(
  value: string,
  source: string,
  providers: readonly P[],
): Array<[P, string]> {
  const entries: Array<[P, string]> = [];
  const seen = new Set<string>();
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (!entry) {
      continue;
    }
    // Only the first colon separates the provider: ids like `x:free` keep theirs.
    const separator = entry.indexOf(':');
    const provider = entry.slice(0, separator).trim().toLowerCase() as P;
    const model = entry.slice(separator + 1).trim();
    if (separator <= 0 || !model || !providers.includes(provider)) {
      logger.warn(`Ignoring invalid ${source} entry "${entry}"`);
      continue;
    }
    const key = `${provider}:${model}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push([provider, model]);
    }
  }
  return entries;
}

function readString(config: ConfigService, key: string): string | undefined {
  const value = config.get<string>(key)?.trim();
  return value === '' ? undefined : value;
}

function readPositiveNumber(
  config: ConfigService,
  key: string,
): number | undefined {
  const value = Number(config.get<string>(key));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
