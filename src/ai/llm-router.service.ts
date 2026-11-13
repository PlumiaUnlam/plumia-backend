import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LLM_USE_CASES,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmProvider,
  type LlmStep,
  type LlmTransport,
  type LlmUseCase,
  type ResolvedLlmStep,
} from './ai.types';
import {
  loadUseCaseSettings,
  serverApiKey,
  type UseCaseSettings,
} from './ai-chains.config';
import {
  AiChainExhaustedError,
  AiNotConfiguredError,
  createAbortError,
  describeError,
  errorStatus,
} from './ai-errors';
import { extractJsonText } from './ai-schema';
import { CircuitBreaker } from './circuit-breaker';
import { AnthropicTransport } from './transports/anthropic.transport';
import { GeminiTransport } from './transports/gemini.transport';
import { OpenRouterTransport } from './transports/openrouter.transport';

export interface GenerateJsonParams<T> {
  useCase: LlmUseCase;
  request: LlmJsonRequest;
  /** Validates the JSON text; throwing moves on to the next step. */
  parse: (text: string) => T;
  /** Replaces the configured chain (e.g. a user's own key). */
  steps?: LlmStep[];
  /** Tried before the configured chain (e.g. the model a user picked). */
  leadingSteps?: LlmStep[];
}

/**
 * Single entry point for every LLM call of the backend. Walks the fallback
 * chain of the use case: a step that fails, times out, returns invalid JSON or
 * has its circuit open is skipped and the next one is tried.
 */
@Injectable()
export class LlmRouter implements OnModuleInit {
  private readonly logger = new Logger(LlmRouter.name);
  private readonly settings = new Map<LlmUseCase, UseCaseSettings>();
  private readonly breaker = new CircuitBreaker();
  private readonly transports: Record<LlmProvider, LlmTransport> = {
    anthropic: new AnthropicTransport(),
    openrouter: new OpenRouterTransport(),
    gemini: new GeminiTransport(),
  };

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    for (const useCase of LLM_USE_CASES) {
      const active = this.resolveSteps(this.settingsFor(useCase).steps);
      this.logger.log(
        `AI chain ${useCase}: ${active.map((step) => `${step.provider}:${step.model}`).join(' > ') || 'sin proveedores configurados'}`,
      );
    }
  }

  hasConfiguredStep(useCase: LlmUseCase): boolean {
    return this.resolveSteps(this.settingsFor(useCase).steps).length > 0;
  }

  async generateJson<T>(
    params: GenerateJsonParams<T>,
  ): Promise<LlmJsonResult<T>> {
    const { useCase, request } = params;
    const settings = this.settingsFor(useCase);
    const steps = this.resolveSteps([
      ...(params.leadingSteps ?? []),
      ...(params.steps ?? settings.steps),
    ]);
    if (steps.length === 0) {
      throw new AiNotConfiguredError(useCase);
    }

    const deadline = Date.now() + settings.totalTimeoutMs;
    const failures: string[] = [];
    for (const [index, step] of steps.entries()) {
      throwIfAborted(request.signal);
      const label = `${step.provider}:${step.model}`;
      const { modelKey, credentialKey } = breakerKeys(step);
      if (this.breaker.isOpen(modelKey, credentialKey)) {
        failures.push(`${label}: circuit open`);
        continue;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        failures.push('time budget exhausted');
        break;
      }
      const timeoutMs = Math.min(settings.stepTimeoutMs, remainingMs);
      const signal = withTimeout(request.signal, timeoutMs);
      try {
        const result = await this.transports[step.provider].generate(
          step,
          { ...request, effort: request.effort ?? settings.effort },
          { signal, timeoutMs },
        );
        throwIfAborted(request.signal);
        const value = params.parse(extractJsonText(result.text));
        this.breaker.recordSuccess(modelKey);
        if (index > 0) {
          this.logger.log(
            `AI ${useCase} served by fallback ${index + 1}/${steps.length} ${label}`,
          );
        }
        return {
          value,
          provider: step.provider,
          model: step.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      } catch (error: unknown) {
        if (request.signal?.aborted) {
          throw createAbortError();
        }
        const status = errorStatus(error);
        this.breaker.recordFailure(modelKey, credentialKey, status);
        const reason =
          signal.aborted && status === undefined
            ? `timeout after ${timeoutMs}ms`
            : describeError(error);
        failures.push(`${label}: ${reason}`);
        this.logger.warn(
          `AI ${useCase} step ${index + 1}/${steps.length} ${label} failed: ${reason}`,
        );
      }
    }
    this.logger.error(`AI ${useCase} exhausted every provider`);
    throw new AiChainExhaustedError(useCase, failures);
  }

  private settingsFor(useCase: LlmUseCase): UseCaseSettings {
    let settings = this.settings.get(useCase);
    if (!settings) {
      settings = loadUseCaseSettings(this.config, useCase);
      this.settings.set(useCase, settings);
    }
    return settings;
  }

  /** Adds the server key, drops steps without one and removes duplicates. */
  private resolveSteps(steps: LlmStep[]): ResolvedLlmStep[] {
    const seen = new Set<string>();
    const resolved: ResolvedLlmStep[] = [];
    for (const step of steps) {
      const apiKey = step.apiKey ?? serverApiKey(this.config, step.provider);
      if (!apiKey || !step.model) {
        continue;
      }
      const credential = step.credential ?? (step.apiKey ? 'user' : 'server');
      const key = `${step.provider}:${step.model}:${fingerprint(apiKey)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      resolved.push({
        provider: step.provider,
        model: step.model,
        apiKey,
        credential,
      });
    }
    return resolved;
  }
}

function breakerKeys(step: ResolvedLlmStep): {
  modelKey: string;
  credentialKey: string;
} {
  // A user's broken key must never open the circuit of the server key.
  const credentialKey = `${step.provider}:${step.credential}:${fingerprint(step.apiKey)}`;
  return { modelKey: `${credentialKey}:${step.model}`, credentialKey };
}

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}
