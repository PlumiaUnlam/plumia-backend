export const SUMMARY_SCOPE = {
  SCENE: 'scene',
  CHAPTER: 'chapter',
} as const;

export type SummaryScope = (typeof SUMMARY_SCOPE)[keyof typeof SUMMARY_SCOPE];

export type SummarySource = 'ai_generated' | 'author_manual';
