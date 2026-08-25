import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './ports/embedding-provider.port';
import {
  VECTOR_STORE,
  type VectorSearchResult,
  type VectorStore,
} from './ports/vector-store.port';
import {
  STALE_CHUNK_STORE,
  type StaleChunkStore,
} from './ports/stale-chunk-store.port';

const INDEX_BATCH_SIZE = 24;
const SEMANTIC_RESULT_LIMIT = 24;
const MAX_COSINE_DISTANCE = 0.55;

@Injectable()
export class ChatEmbeddingIndexService {
  private readonly logger = new Logger(ChatEmbeddingIndexService.name);
  private readonly indexingByProject = new Map<string, Promise<void>>();

  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    @Inject(STALE_CHUNK_STORE)
    private readonly staleChunkStore: StaleChunkStore,
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
      await this.ensureIndexBatch(projectId, signal);
      throwIfAborted(signal);
      const queryEmbedding = signal
        ? await this.embeddingProvider.embedQuery(question, signal)
        : await this.embeddingProvider.embedQuery(question);
      throwIfAborted(signal);
      const matches = await this.vectorStore.search({
        projectId,
        embedding: queryEmbedding,
        model: this.embeddingProvider.model,
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

  private async ensureIndexBatch(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let indexing = this.indexingByProject.get(projectId);
    if (!indexing) {
      indexing = this.indexNextBatch(projectId);
      this.indexingByProject.set(projectId, indexing);
      void indexing
        .finally(() => {
          if (this.indexingByProject.get(projectId) === indexing) {
            this.indexingByProject.delete(projectId);
          }
        })
        .catch(() => undefined);
    }
    await waitForAbort(indexing, signal);
  }

  private async indexNextBatch(projectId: string): Promise<void> {
    const model = this.embeddingProvider.model;
    const chunks = await this.staleChunkStore.findStaleChunks(
      projectId,
      model,
      INDEX_BATCH_SIZE,
    );
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

async function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw createAbortError();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
