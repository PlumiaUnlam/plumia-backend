import type { SummaryJobStatus } from '@prisma/client';
import type { SummaryScope, SummarySource } from '../domain/summary-scope';

export const SUMMARY_REPOSITORY = Symbol('SUMMARY_REPOSITORY');

export interface SummaryRecord {
  id: string;
  projectId: string;
  parentSummaryId: string | null;
  scopeType: SummaryScope;
  scopeId: string;
  title: string | null;
  content: string;
  source: SummarySource;
  sourceContentHash: string | null;
  provider: string | null;
  model: string | null;
  isDirty: boolean;
  tokenCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SummaryJobRecord {
  id: string;
  projectId: string;
  scopeType: SummaryScope;
  scopeId: string;
  inputHash: string;
  status: SummaryJobStatus;
  progress: number;
  force: boolean;
  bullJobId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface SceneSummaryInput {
  id: string;
  projectId: string;
  chapterId: string;
  title: string | null;
  content: unknown;
  contentHash: string | null;
  wordCount: number;
}

export interface ChapterSummaryInput {
  id: string;
  projectId: string;
  title: string;
  scenes: SceneSummaryInput[];
}

export interface SummaryRepository {
  findSummary(
    userId: string,
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryRecord | null>;
  findSummaryByScope(
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryRecord | null>;
  findSceneInput(
    userId: string,
    sceneId: string,
  ): Promise<SceneSummaryInput | null>;
  findSceneInputById(sceneId: string): Promise<SceneSummaryInput | null>;
  findChapterInput(
    userId: string,
    chapterId: string,
  ): Promise<ChapterSummaryInput | null>;
  findChapterInputById(chapterId: string): Promise<ChapterSummaryInput | null>;
  createOrGetJob(input: {
    projectId: string;
    scope: SummaryScope;
    scopeId: string;
    inputHash: string;
    force: boolean;
    bullJobId: string;
  }): Promise<SummaryJobRecord>;
  findJobForUser(
    userId: string,
    jobId: string,
  ): Promise<SummaryJobRecord | null>;
  markJobProcessing(jobId: string): Promise<void>;
  markJobCompleted(jobId: string): Promise<void>;
  markJobFailed(jobId: string, message: string): Promise<void>;
  upsertGenerated(
    input: Omit<
      SummaryRecord,
      'id' | 'parentSummaryId' | 'createdAt' | 'updatedAt' | 'source'
    >,
  ): Promise<SummaryRecord>;
  updateManual(
    userId: string,
    id: string,
    content: string,
  ): Promise<SummaryRecord | null>;
  invalidateScene(
    sceneId: string,
    chapterId: string,
  ): Promise<{ scene: SummaryRecord | null; chapter: SummaryRecord | null }>;
}
