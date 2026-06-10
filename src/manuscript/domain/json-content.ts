import { createHash } from 'node:crypto';

export type JsonObject = Record<string, unknown>;

export function createContentHash(content: JsonObject): string {
  return createHash('sha256').update(stableStringify(content)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
