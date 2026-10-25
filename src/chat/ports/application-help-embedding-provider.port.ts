export const APPLICATION_HELP_EMBEDDING_PROVIDER = Symbol(
  'APPLICATION_HELP_EMBEDDING_PROVIDER',
);

export interface ApplicationHelpEmbeddingProvider {
  readonly profile: string;
  isConfigured(): boolean;
  embedDocuments(
    documents: Array<{ title: string; content: string }>,
  ): Promise<number[][]>;
  embedQuery(question: string, signal?: AbortSignal): Promise<number[]>;
}
