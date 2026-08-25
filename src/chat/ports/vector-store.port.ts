// Port (interfaz de dominio) para almacenamiento y busqueda vectorial.
// El dominio depende de ESTA abstraccion, nunca de pgvector/Postgres.
// Token de inyeccion para el adapter concreto.
export const VECTOR_STORE = Symbol('VECTOR_STORE');

export interface ChunkUpsertInput {
  projectId: string;
  sceneId: string;
  content: string;
  embedding: number[];
  model: string;
  tokenCount: number;
  chunkIndex: number;
  contentHash?: string | null;
}

export interface VectorSearchInput {
  projectId: string;
  embedding: number[];
  model: string;
  limit: number;
}

export interface VectorSearchResult {
  chunkId: string;
  sceneId: string;
  content: string;
  // Distancia (menor = mas similar). Para coseno: 0 = identico, 2 = opuesto.
  distance: number;
}

export interface ChunkEmbeddingUpdateInput {
  chunkId: string;
  embedding: number[];
  contentHash: string;
  model: string;
}

export interface VectorStore {
  upsertChunk(input: ChunkUpsertInput): Promise<void>;
  updateChunkEmbedding(input: ChunkEmbeddingUpdateInput): Promise<void>;
  search(input: VectorSearchInput): Promise<VectorSearchResult[]>;
}
