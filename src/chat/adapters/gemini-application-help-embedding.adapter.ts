import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApplicationHelpEmbeddingProvider } from '../ports/application-help-embedding-provider.port';

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 1_536;
const DEFAULT_TIMEOUT_MS = 45_000;

@Injectable()
export class GeminiApplicationHelpEmbeddingAdapter implements ApplicationHelpEmbeddingProvider {
  readonly profile: string;
  private readonly model: string;
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
    this.model =
      configuredModel && configuredModel.length > 0
        ? configuredModel
        : DEFAULT_EMBEDDING_MODEL;
    this.profile = `${this.model}:application-help-qa-v1:${EMBEDDING_DIMENSIONS}`;

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

  embedDocuments(
    documents: Array<{ title: string; content: string }>,
  ): Promise<number[][]> {
    const contents: Content[] = documents.map((document) => ({
      role: 'user',
      parts: [
        {
          text: `title: ${document.title} | text: ${document.content}`,
        },
      ],
    }));
    return this.embed(contents);
  }

  async embedQuery(question: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embed(
      `task: question answering | query: ${question}`,
      signal,
    );
    if (!embedding) {
      throw new Error(
        'Gemini API returned no application help query embedding',
      );
    }
    return embedding;
  }

  private async embed(
    contents: string | Content[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (!this.isConfigured()) {
      return [];
    }
    const response = await this.ai.models.embedContent({
      model: this.model,
      contents,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    const embeddings = response.embeddings ?? [];
    const expectedCount = typeof contents === 'string' ? 1 : contents.length;
    if (embeddings.length !== expectedCount) {
      throw new Error(
        'Gemini API returned an incomplete application help batch',
      );
    }
    return embeddings.map((embedding) => {
      if (embedding.values?.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          'Gemini API returned an invalid application help embedding dimension',
        );
      }
      return embedding.values;
    });
  }
}
