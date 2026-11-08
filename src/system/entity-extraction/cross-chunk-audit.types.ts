import type { ContinuityCheckpointClaim } from './entity-extraction.types';

export interface AuditChunk {
  id: string;
  chunkIndex: number;
  content: string;
  contentHash: string | null;
}

export interface KnownEntity {
  id: string | null;
  canonicalName: string;
  aliases: string[];
  type: string;
  description: string | null;
  attributes: Record<string, unknown>;
}

export interface ContinuityScene {
  id: string;
  title: string | null;
  order: number;
  sortKey: string;
  chapter: {
    sortKey: string;
    book: { sortKey: string };
  };
  chunks: AuditChunk[];
}

export interface ContinuityResumePoint {
  startIndex: number;
  claims: ContinuityCheckpointClaim[];
}

export const MAX_SCENE_GROUP_CHUNKS = 5;

export const MAX_CHECKPOINT_CLAIMS = 200;

export const entitySelect = {
  id: true,
  canonicalName: true,
  aliases: true,
  type: true,
  description: true,
  attributes: true,
} as const;
