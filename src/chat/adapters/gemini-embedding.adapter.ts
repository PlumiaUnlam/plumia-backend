import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../ports/embedding-provider.port';

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 1_536;
const DEFAULT_TIMEOUT_MS = 45_000;

@Injectable()
export class GeminiEmbeddingAdapter implements EmbeddingProvider {
  readonly model: string;
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    const dedicatedApiKey = config
      .get<string>('GEMINI_EMBEDDING_API_KEY')
      ?.trim();
    const sharedApiKey = config.get<string>('GEMINI_API_KEY')?.trim();
    this.apiKey = [dedicatedApiKey, sharedApiKey].find(Boolean) ?? '';
    const configuredModel = config
      .get<string>('GEMINI_EMBEDDING_MODEL')
      ?.trim();
    this.model = configuredModel ?? DEFAULT_EMBEDDING_MODEL;
    const configuredTimeout = Number(
      config.get<string>('GEMINI_EMBEDDING_TIMEOUT_MS'),
    );
    const timeout =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS;
    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  embedDocuments(contents: string[]): Promise<number[][]> {
    return this.embed(contents, 'RETRIEVAL_DOCUMENT');
  }

  async embedQuery(content: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embed([content], 'RETRIEVAL_QUERY', signal);
    if (!embedding) {
      throw new Error('Gemini API returned no query embedding');
    }
    return embedding;
  }

  private async embed(
    contents: string[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (!this.isConfigured() || contents.length === 0) {
      return [];
    }
    const response = await this.ai.models.embedContent({
      model: this.model,
      contents,
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== contents.length) {
      throw new Error('Gemini API returned an incomplete embedding batch');
    }
    return embeddings.map((embedding) => {
      if (embedding.values?.length !== EMBEDDING_DIMENSIONS) {
        throw new Error('Gemini API returned an invalid embedding dimension');
      }
      return embedding.values;
    });
  }
}
