export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface EmbeddingProvider {
  readonly model: string;
  isConfigured(): boolean;
  embedDocuments(contents: string[]): Promise<number[][]>;
  embedQuery(content: string): Promise<number[]>;
}
