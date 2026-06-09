import { Inject, Injectable } from '@nestjs/common';
import { VECTOR_STORE } from './ports/vector-store.port';
import type {
  VectorSearchResult,
  VectorStore,
} from './ports/vector-store.port';

// Contexto Chat y Embeddings: ChatThread, ChatMessage, Chunk, Summary.
// Depende del port VectorStore (no de pgvector). La generacion de embeddings
// (llamada al proveedor LLM) y la orquestacion RAG se implementan en fases posteriores.
@Injectable()
export class ChatService {
  constructor(
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
  ) {}

  searchSimilarChunks(
    projectId: string,
    embedding: number[],
    limit = 8,
  ): Promise<VectorSearchResult[]> {
    return this.vectorStore.search({ projectId, embedding, limit });
  }
}
