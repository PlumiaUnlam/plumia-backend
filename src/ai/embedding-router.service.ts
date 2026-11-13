import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EmbeddingProviderName,
  EmbeddingTaskType,
  EmbeddingTransport,
} from './ai.types';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_SPACE,
  embeddingApiKey,
  loadEmbeddingSettings,
  type EmbeddingSettings,
} from './ai-chains.config';
import {
  AiChainExhaustedError,
  AiNotConfiguredError,
  createAbortError,
  describeError,
  errorStatus,
} from './ai-errors';
import { CircuitBreaker } from './circuit-breaker';
import { GeminiTransport } from './transports/gemini.transport';
import { OpenRouterTransport } from './transports/openrouter.transport';

/**
 * Embeddings for the vector index. Every route returns vectors of the same
 * embedding space, so the stored index stays valid whichever route answers.
 */
@Injectable()
export class EmbeddingRouter implements OnModuleInit {
  /** Stored next to each vector; changing it forces a reindex. */
  readonly space = EMBEDDING_SPACE;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly logger = new Logger(EmbeddingRouter.name);
  private readonly breaker = new CircuitBreaker();
  private readonly settings: EmbeddingSettings;
  private readonly transports: Record<
    EmbeddingProviderName,
    EmbeddingTransport
  > = {
    openrouter: new OpenRouterTransport(),
    gemini: new GeminiTransport(),
  };

  constructor(private readonly config: ConfigService) {
    this.settings = loadEmbeddingSettings(config);
  }

  onModuleInit(): void {
    const active = this.activeSteps();
    this.logger.log(
      `AI chain embedding (${this.space}, ${this.dimensions}d): ${active.map((step) => `${step.provider}:${step.model}`).join(' > ') || 'sin proveedores configurados'}`,
    );
  }

  isConfigured(): boolean {
    return this.activeSteps().length > 0;
  }

  async embed(
    texts: string[],
    options: { taskType?: EmbeddingTaskType; signal?: AbortSignal } = {},
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const steps = this.activeSteps();
    if (steps.length === 0) {
      throw new AiNotConfiguredError('embedding');
    }
    const failures: string[] = [];
    for (const step of steps) {
      throwIfAborted(options.signal);
      const label = `${step.provider}:${step.model}`;
      const credentialKey = `${step.provider}:server`;
      const modelKey = `${credentialKey}:${step.model}`;
      if (this.breaker.isOpen(modelKey, credentialKey)) {
        failures.push(`${label}: circuit open`);
        continue;
      }
      const timeoutMs = this.settings.stepTimeoutMs;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;
      try {
        const vectors = await this.transports[step.provider].embed(
          step,
          {
            texts,
            dimensions: this.dimensions,
            ...(options.taskType ? { taskType: options.taskType } : {}),
          },
          { signal, timeoutMs },
        );
        if (vectors.length !== texts.length) {
          throw new Error('incomplete embedding batch');
        }
        if (vectors.some((vector) => vector.length !== this.dimensions)) {
          throw new Error('invalid embedding dimension');
        }
        this.breaker.recordSuccess(modelKey);
        return vectors;
      } catch (error: unknown) {
        if (options.signal?.aborted) {
          throw createAbortError();
        }
        const status = errorStatus(error);
        this.breaker.recordFailure(modelKey, credentialKey, status);
        const reason =
          timeout.aborted && status === undefined
            ? `timeout after ${timeoutMs}ms`
            : describeError(error);
        failures.push(`${label}: ${reason}`);
        this.logger.warn(`AI embedding ${label} failed: ${reason}`);
      }
    }
    throw new AiChainExhaustedError('embedding', failures);
  }

  private activeSteps(): Array<{
    provider: EmbeddingProviderName;
    model: string;
    apiKey: string;
  }> {
    return this.settings.steps.flatMap((step) => {
      const apiKey = embeddingApiKey(this.config, step.provider);
      return apiKey ? [{ ...step, apiKey }] : [];
    });
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}
