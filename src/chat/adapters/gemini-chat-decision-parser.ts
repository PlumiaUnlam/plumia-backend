import type { ChatIntent } from '../ports/chat-intent-provider.port';

const VALID_INTENTS = new Set<ChatIntent>([
  'work',
  'application_help',
  'out_of_scope',
  'clarify',
  'unsafe',
  'creative',
]);

export function parseIntentResponse(value: string): ChatIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SyntaxError('Gemini API returned invalid routing JSON');
  }
  const intent = toRecord(parsed)?.['intent'];
  if (typeof intent !== 'string' || !VALID_INTENTS.has(intent as ChatIntent)) {
    throw new TypeError('Gemini API returned an invalid chat intent');
  }
  return intent as ChatIntent;
}

export function parseVerificationResponse(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SyntaxError('Gemini API returned invalid verification JSON');
  }
  const supported = toRecord(parsed)?.['supported'];
  if (typeof supported !== 'boolean') {
    throw new TypeError('Gemini API returned an invalid evidence decision');
  }
  return supported;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
