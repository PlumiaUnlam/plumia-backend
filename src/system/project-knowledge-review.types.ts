import type {
  CrossChunkAuditMode,
  KnowledgeReviewMode,
  KnowledgeAnalysisRunStatus,
  KnowledgeAnalysisSceneStatus,
} from '@prisma/client';

export interface PendingScene {
  id: string;
  title: string | null;
  order: number;
  sortKey: string;
  chapter: {
    title: string;
    sortKey: string;
    book: { title: string; sortKey: string };
  };
  chunks: Array<{ id: string; chunkIndex: number; isDirty: boolean }>;
}

export interface KnowledgeReviewSettingsResponse {
  stateTrackingEnabled: boolean;
  stateReviewMode: KnowledgeReviewMode;
  stateConfidenceThreshold: number;
  relationshipReviewMode: KnowledgeReviewMode;
  relationshipConfidenceThreshold: number;
  crossChunkAuditMode: CrossChunkAuditMode;
  updatedAt: Date;
}

export interface KnowledgeAnalysisPreview {
  projectId: string;
  sceneCount: number;
  chunkCount: number;
  crossChunkAuditMode: CrossChunkAuditMode;
  affectedAdjacentPairs: number;
  continuityGroupsToAnalyze: number;
  continuityScenesToRecalculate: number;
  continuityCheckpointsToRecalculate: number;
  scenes: {
    id: string;
    title: string;
    chapterTitle: string;
    bookTitle: string;
    pendingChunks: number;
  }[];
}

export interface KnowledgeAnalysisRunResponse {
  id: string;
  projectId: string;
  status: KnowledgeAnalysisRunStatus;
  totalScenes: number;
  processedScenes: number;
  failedScenes: number;
  totalChunks: number;
  createdAt: Date;
  completedAt: Date | null;
  scenes: {
    id: string;
    title: string;
    chapterTitle: string;
    bookTitle: string;
    status: KnowledgeAnalysisSceneStatus;
    totalChunks: number;
    processedChunks: number;
    error: string | null;
  }[];
}

export type KnowledgeAnalysisStartResponse =
  | { status: 'ALREADY_QUEUED'; run: KnowledgeAnalysisRunResponse }
  | { status: 'NO_CHANGES'; run: null }
  | { status: 'QUEUED'; run: KnowledgeAnalysisRunResponse };

export interface KnowledgeAnalysisRetryResponse {
  status: 'QUEUED';
  run: KnowledgeAnalysisRunResponse;
}
