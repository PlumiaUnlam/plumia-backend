export const STALE_CHUNK_STORE = Symbol('STALE_CHUNK_STORE');

export interface StaleChunk {
  id: string;
  content: string;
  contentHash: string;
}

export interface StaleChunkStore {
  findStaleChunks(
    projectId: string,
    model: string,
    limit: number,
  ): Promise<StaleChunk[]>;
}
