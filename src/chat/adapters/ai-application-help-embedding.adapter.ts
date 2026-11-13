import { Injectable } from '@nestjs/common';
import { EmbeddingRouter } from '../../ai/embedding-router.service';
import type { ApplicationHelpEmbeddingProvider } from '../ports/application-help-embedding-provider.port';

/**
 * PlumIA help corpus embeddings. The task is written in the text itself
 * (`task: ... | query: ...`), so every route produces the same vectors and
 * the stored `profile` keeps matching.
 */
@Injectable()
export class AiApplicationHelpEmbeddingAdapter implements ApplicationHelpEmbeddingProvider {
  readonly profile: string;

  constructor(private readonly embeddings: EmbeddingRouter) {
    this.profile = `${embeddings.space}:application-help-qa-v1:${embeddings.dimensions}`;
  }

  isConfigured(): boolean {
    return this.embeddings.isConfigured();
  }

  embedDocuments(
    documents: Array<{ title: string; content: string }>,
  ): Promise<number[][]> {
    return this.embeddings.embed(
      documents.map(
        (document) => `title: ${document.title} | text: ${document.content}`,
      ),
    );
  }

  async embedQuery(question: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embeddings.embed(
      [`task: question answering | query: ${question}`],
      signal ? { signal } : {},
    );
    if (!embedding) {
      throw new Error(
        'Embedding provider returned no application help query embedding',
      );
    }
    return embedding;
  }
}
