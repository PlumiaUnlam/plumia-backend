import { Injectable } from '@nestjs/common';
import { EmbeddingRouter } from '../../ai/embedding-router.service';
import type { EmbeddingProvider } from '../ports/embedding-provider.port';

/**
 * Manuscript embeddings. `model` is the embedding space stored next to every
 * chunk (`gemini-embedding-2`); it stays the same whichever route answers, so
 * the existing index keeps matching.
 */
@Injectable()
export class AiEmbeddingAdapter implements EmbeddingProvider {
  readonly model: string;

  constructor(private readonly embeddings: EmbeddingRouter) {
    this.model = embeddings.space;
  }

  isConfigured(): boolean {
    return this.embeddings.isConfigured();
  }

  embedDocuments(contents: string[]): Promise<number[][]> {
    return this.embeddings.embed(contents, { taskType: 'RETRIEVAL_DOCUMENT' });
  }

  async embedQuery(content: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embeddings.embed([content], {
      taskType: 'RETRIEVAL_QUERY',
      ...(signal ? { signal } : {}),
    });
    if (!embedding) {
      throw new Error('Embedding provider returned no query embedding');
    }
    return embedding;
  }
}
