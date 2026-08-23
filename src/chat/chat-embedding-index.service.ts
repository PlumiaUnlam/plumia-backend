import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './ports/embedding-provider.port';
import {
  VECTOR_STORE,
  type VectorSearchResult,
  type VectorStore,
} from './ports/vector-store.port';

const INDEX_BATCH_SIZE = 24;
const SEMANTIC_RESULT_LIMIT = 24;
const MAX_COSINE_DISTANCE = 0.55;

interface StaleChunkRow {
  id: string;
  content: string;
  contentHash: string;
}

@Injectable()
export class ChatEmbeddingIndexService {
  private readonly logger = new Logger(ChatEmbeddingIndexService.name);
  private readonly indexingByProject = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
  ) {}

  async search(
    projectId: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<VectorSearchResult[]> {
    throwIfAborted(signal);
    if (!this.embeddingProvider.isConfigured()) {
      return [];
    }
    try {
      await this.ensureIndexBatch(projectId);
      throwIfAborted(signal);
      const queryEmbedding = signal
        ? await this.embeddingProvider.embedQuery(question, signal)
        : await this.embeddingProvider.embedQuery(question);
      throwIfAborted(signal);
      const matches = await this.vectorStore.search({
        projectId,
        embedding: queryEmbedding,
        limit: SEMANTIC_RESULT_LIMIT,
      });
      throwIfAborted(signal);
      return matches.filter(
        (match) =>
          Number.isFinite(match.distance) &&
          match.distance >= 0 &&
          match.distance <= MAX_COSINE_DISTANCE,
      );
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Semantic retrieval unavailable for project ${projectId}: ${message}`,
      );
      return [];
    }
  }

  private async ensureIndexBatch(projectId: string): Promise<void> {
    const running = this.indexingByProject.get(projectId);
    if (running) {
      await running;
      return;
    }
    const indexing = this.indexNextBatch(projectId);
    this.indexingByProject.set(projectId, indexing);
    try {
      await indexing;
    } finally {
      if (this.indexingByProject.get(projectId) === indexing) {
        this.indexingByProject.delete(projectId);
      }
    }
  }

  private async indexNextBatch(projectId: string): Promise<void> {
    const model = this.embeddingProvider.model;
    const chunks = await this.prisma.$queryRaw<StaleChunkRow[]>`
      SELECT
        "id",
        "content",
        "content_hash" AS "contentHash"
      FROM "chunk"
      WHERE "project_id" = ${projectId}::uuid
        AND "content_hash" IS NOT NULL
        AND (
          "embedding" IS NULL
          OR "embedding_content_hash" IS DISTINCT FROM "content_hash"
          OR "embedding_model" IS DISTINCT FROM ${model}
        )
      ORDER BY "updated_at" DESC
      LIMIT ${INDEX_BATCH_SIZE}
    `;
    if (chunks.length === 0) {
      return;
    }

    const embeddings = await this.embeddingProvider.embedDocuments(
      chunks.map((chunk) => chunk.content),
    );
    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding provider returned an incomplete batch');
    }
    await Promise.all(
      chunks.map((chunk, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          throw new Error('Embedding provider returned an empty vector');
        }
        return this.vectorStore.updateChunkEmbedding({
          chunkId: chunk.id,
          embedding,
          contentHash: chunk.contentHash,
          model,
        });
      }),
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('Chat retrieval aborted by the client');
  error.name = 'AbortError';
  return error;
}
