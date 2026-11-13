import type { ChatHistoryEntry } from './chat-generation-provider.port';
import type { WorkQuestionType } from '../domain/work-question-type';

export const CHAT_INTENT_PROVIDER = Symbol('CHAT_INTENT_PROVIDER');

export type ChatIntent =
  | 'work'
  | 'application_help'
  | 'out_of_scope'
  | 'clarify'
  | 'unsafe'
  | 'creative';

/** Datos de la obra abierta; ayudan a reconocer preguntas sobre sus entidades. */
export interface ChatWorkContext {
  entityNames: string[];
}

export interface ChatIntentInput {
  question: string;
  history: ChatHistoryEntry[];
  helpHint: boolean;
  workContext?: ChatWorkContext;
  signal?: AbortSignal;
}

export interface ChatIntentResult {
  intent: ChatIntent;
  workQuestionType?: WorkQuestionType;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatIntentProvider {
  classify(input: ChatIntentInput): Promise<ChatIntentResult>;
}
