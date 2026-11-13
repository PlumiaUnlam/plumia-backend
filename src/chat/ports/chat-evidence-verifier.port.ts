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
  /** True only when every claim is supported. */
  supported: boolean;
  /**
   * Indexes (in `claims`) of the claims judged supported one by one. When some
   * claims fail, the chat keeps only these instead of discarding the answer.
   */
  supportedClaimIndexes?: number[];
  inputTokens: number;
  outputTokens: number;
}

export interface ChatEvidenceVerifier {
  verify(
    input: ChatEvidenceVerificationInput,
  ): Promise<ChatEvidenceVerificationResult>;
}
