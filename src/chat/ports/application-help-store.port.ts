export const APPLICATION_HELP_STORE = Symbol('APPLICATION_HELP_STORE');

export interface ApplicationHelpChunkInput {
  id: string;
  docId: string;
  title: string;
  breadcrumb: string;
  area: string;
  route: string;
  related: string[];
  questions: string[];
  keywords: string[];
  content: string;
  embedText: string;
  words: number;
  sources: string[];
  updated: string;
  contentHash: string;
}

export interface StaleApplicationHelpChunk {
  id: string;
  title: string;
  embedText: string;
  contentHash: string;
}

export interface ApplicationHelpSearchInput {
  query: string;
  profile: string;
  embedding?: number[];
  limit: number;
}

export interface ApplicationHelpSearchResult {
  id: string;
  title: string;
  breadcrumb: string;
  area: string;
  route: string;
  related: string[];
  content: string;
}

export interface ApplicationHelpStore {
  syncSnapshot(chunks: ApplicationHelpChunkInput[]): Promise<void>;
  findStaleChunks(
    profile: string,
    limit: number,
  ): Promise<StaleApplicationHelpChunk[]>;
  updateEmbedding(input: {
    id: string;
    embedding: number[];
    contentHash: string;
    profile: string;
  }): Promise<boolean>;
  search(
    input: ApplicationHelpSearchInput,
  ): Promise<ApplicationHelpSearchResult[]>;
}
