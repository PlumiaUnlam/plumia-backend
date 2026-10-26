import type { ChatGenerationResult } from './chat-generation-provider.port';
import type { ChatOpenConflict, ChatSource } from '../domain/chat.types';
import type { WorkQuestionType } from '../domain/work-question-type';

export const CHAT_EVIDENCE_VERIFIER = Symbol('CHAT_EVIDENCE_VERIFIER');

export interface ChatEvidenceVerificationInput {
  question: string;
  claims: ChatGenerationResult['claims'];
  sources: ChatSource[];
  openConflicts?: ChatOpenConflict[];
  workQuestionType?: WorkQuestionType;
  signal?: AbortSignal;
}

export interface ChatEvidenceVerificationResult {
  supported: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatEvidenceVerifier {
  verify(
    input: ChatEvidenceVerificationInput,
  ): Promise<ChatEvidenceVerificationResult>;
}
