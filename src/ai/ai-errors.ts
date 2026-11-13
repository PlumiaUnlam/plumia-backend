/** HTTP-level failure of one provider call. */
export class AiProviderError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** No step of the chain has a credential configured. */
export class AiNotConfiguredError extends Error {
  constructor(readonly useCase: string) {
    super(`No AI provider is configured for ${useCase}`);
    this.name = 'AiNotConfiguredError';
  }
}

/** Every configured step failed (or the time budget ran out). */
export class AiChainExhaustedError extends Error {
  constructor(
    readonly useCase: string,
    readonly failures: string[],
  ) {
    super(
      `All AI providers failed for ${useCase}: ${failures.join(' | ') || 'no attempt was possible'}`,
    );
    this.name = 'AiChainExhaustedError';
  }
}

export function createAbortError(
  message = 'The AI request was aborted',
): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reads the HTTP status from SDK errors (Gemini, Anthropic) and our own. */
export function errorStatus(error: unknown): number | undefined {
  const record = toRecord(error);
  const nested = toRecord(record?.['error']);
  const candidates = [
    record?.['status'],
    record?.['statusCode'],
    record?.['httpStatus'],
    nested?.['status'],
    nested?.['code'],
  ];
  const status = candidates.find(
    (value): value is number =>
      typeof value === 'number' && value >= 100 && value < 600,
  );
  return status;
}

/** One-line, length-bounded description that never includes request data. */
export function describeError(error: unknown): string {
  const status = errorStatus(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown provider error';
  const clean = message.replace(/\s+/gu, ' ').trim().slice(0, 300);
  return status === undefined ? clean : `status=${status} ${clean}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
