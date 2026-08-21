import type { ChatSource } from '../domain/chat.types';

export const CHAT_GENERATION_PROVIDER = Symbol('CHAT_GENERATION_PROVIDER');

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatGenerationInput {
  question: string;
  history: ChatHistoryEntry[];
  sources: ChatSource[];
}

export interface ChatGroundedClaim {
  text: string;
  evidence: Array<{
    sourceId: string;
    quote: string;
  }>;
}

export interface ChatGenerationResult {
  answer: string;
  sourceIds: string[];
  claims: ChatGroundedClaim[];
  inputTokens: number;
  outputTokens: number;
}

export interface ChatGenerationProvider {
  generate(input: ChatGenerationInput): Promise<ChatGenerationResult>;
}
