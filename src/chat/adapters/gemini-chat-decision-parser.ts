import type { ChatIntent } from '../ports/chat-intent-provider.port';
import {
  WORK_QUESTION_TYPES,
  type WorkQuestionType,
} from '../domain/work-question-type';

const VALID_INTENTS = new Set<ChatIntent>([
  'work',
  'application_help',
  'out_of_scope',
  'clarify',
  'unsafe',
  'creative',
]);

export function parseIntentResponse(value: string): {
  intent: ChatIntent;
  workQuestionType?: WorkQuestionType;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SyntaxError('AI provider returned invalid routing JSON');
  }
  const record = toRecord(parsed);
  const intent = record?.['intent'];
  if (typeof intent !== 'string' || !VALID_INTENTS.has(intent as ChatIntent)) {
    throw new TypeError('AI provider returned an invalid chat intent');
  }
  const workQuestionType = record?.['workQuestionType'];
  return {
    intent: intent as ChatIntent,
    ...(intent === 'work' &&
    typeof workQuestionType === 'string' &&
    WORK_QUESTION_TYPES.includes(workQuestionType as WorkQuestionType)
      ? { workQuestionType: workQuestionType as WorkQuestionType }
      : {}),
  };
}

/**
 * Per-claim verdicts: `{"claims":[{"index":0,"supported":true}, ...]}`.
 * A claim without a verdict counts as unsupported (fail closed).
 */
export function parseClaimVerdicts(
  value: string,
  claimCount: number,
): { supported: boolean; supportedClaimIndexes: number[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new SyntaxError('AI provider returned invalid verification JSON');
  }
  const verdicts = toRecord(parsed)?.['claims'];
  if (!Array.isArray(verdicts)) {
    throw new TypeError('AI provider returned invalid claim verdicts');
  }
  const supportedIndexes = new Set<number>();
  for (const verdict of verdicts) {
    const record = toRecord(verdict);
    const index = record?.['index'];
    const supported = record?.['supported'];
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      typeof supported !== 'boolean'
    ) {
      throw new TypeError('AI provider returned an invalid claim verdict');
    }
    if (supported && index >= 0 && index < claimCount) {
      supportedIndexes.add(index);
    }
  }
  const supportedClaimIndexes = [...supportedIndexes].sort((a, b) => a - b);
  return {
    supported: supportedClaimIndexes.length === claimCount,
    supportedClaimIndexes,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
