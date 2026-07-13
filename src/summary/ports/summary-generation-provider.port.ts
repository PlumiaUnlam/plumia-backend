export const SUMMARY_GENERATION_PROVIDER = Symbol(
  'SUMMARY_GENERATION_PROVIDER',
);

export interface SummaryGenerationInput {
  scope: 'scene' | 'chapter';
  text: string;
  targetWords: number;
  revisionInstructions?: string;
}

export interface SummaryVerificationInput {
  scope: 'scene' | 'chapter';
  sourceText: string;
  summary: string;
}

export interface SummaryVerificationResult {
  approved: boolean;
  violations: string[];
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

export interface SummaryGenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

export interface SummaryGenerationProvider {
  generate(input: SummaryGenerationInput): Promise<SummaryGenerationResult>;
  verify(input: SummaryVerificationInput): Promise<SummaryVerificationResult>;
}
