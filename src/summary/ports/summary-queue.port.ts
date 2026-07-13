import type { SummaryScope } from '../domain/summary-scope';

export const SUMMARY_QUEUE = Symbol('SUMMARY_QUEUE');

export interface SummaryQueueJobData {
  summaryJobId: string;
  scope: SummaryScope;
  scopeId: string;
  force: boolean;
}

export interface SummaryQueue {
  enqueueGeneration(data: SummaryQueueJobData, priority: number): Promise<void>;
  enqueueInvalidation(sceneId: string, chapterId: string): Promise<void>;
}
