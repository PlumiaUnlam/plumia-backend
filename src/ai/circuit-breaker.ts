const FAILURES_TO_OPEN = 3;
const MODEL_COOLDOWN_MS = 60_000;
/** 401/402/403: bad key, no credit or no access. Retrying soon is pointless. */
const CREDENTIAL_COOLDOWN_MS = 5 * 60_000;
const CREDENTIAL_STATUSES = new Set([401, 402, 403]);

/**
 * In-memory breaker shared by every use case of the process. A step that keeps
 * failing is skipped for a while, so a provider outage does not add its
 * timeout to every request.
 */
export class CircuitBreaker {
  private readonly failures = new Map<string, number>();
  private readonly openUntil = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  isOpen(modelKey: string, credentialKey: string): boolean {
    return this.isKeyOpen(credentialKey) || this.isKeyOpen(modelKey);
  }

  recordSuccess(modelKey: string): void {
    this.failures.delete(modelKey);
    this.openUntil.delete(modelKey);
  }

  recordFailure(
    modelKey: string,
    credentialKey: string,
    status: number | undefined,
  ): void {
    if (status !== undefined && CREDENTIAL_STATUSES.has(status)) {
      this.openUntil.set(credentialKey, this.now() + CREDENTIAL_COOLDOWN_MS);
      return;
    }
    const count = (this.failures.get(modelKey) ?? 0) + 1;
    if (count >= FAILURES_TO_OPEN) {
      this.failures.delete(modelKey);
      this.openUntil.set(modelKey, this.now() + MODEL_COOLDOWN_MS);
      return;
    }
    this.failures.set(modelKey, count);
  }

  private isKeyOpen(key: string): boolean {
    const until = this.openUntil.get(key);
    if (until === undefined) {
      return false;
    }
    if (until <= this.now()) {
      this.openUntil.delete(key);
      return false;
    }
    return true;
  }
}
