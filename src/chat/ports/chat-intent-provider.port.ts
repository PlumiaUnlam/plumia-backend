import type { ChatHistoryEntry } from './chat-generation-provider.port';

export const CHAT_INTENT_PROVIDER = Symbol('CHAT_INTENT_PROVIDER');

export type ChatIntent =
  | 'work'
  | 'application_help'
  | 'out_of_scope'
  | 'clarify'
  | 'unsafe'
  | 'creative';

export interface ChatIntentInput {
  question: string;
  history: ChatHistoryEntry[];
  helpHint: boolean;
  signal?: AbortSignal;
}

export interface ChatIntentResult {
  intent: ChatIntent;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatIntentProvider {
  classify(input: ChatIntentInput): Promise<ChatIntentResult>;
}
