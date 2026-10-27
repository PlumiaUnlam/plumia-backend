export const SINGLE_VALUE_STATE_KEYS = new Set([
  'location',
  'status',
  'health_status',
]);

export function normalizeEntityStateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}
