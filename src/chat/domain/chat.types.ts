export type ChatSourceKind =
  | 'manuscript'
  | 'wiki'
  | 'timeline'
  | 'application';

export interface ChatSource {
  id: string;
  kind: ChatSourceKind;
  label: string;
  excerpt: string;
  bookId?: string;
  bookTitle?: string;
  chapterId?: string;
  chapterTitle?: string;
  sceneId?: string;
  sceneTitle?: string | null;
  entityId?: string;
  imageUrl?: string | null;
  occurrenceCount?: number;
  textQuote?: string;
  route?: string;
}

export interface ChatThreadRecord {
  id: string;
  projectId: string;
  title: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatThreadPageRecord {
  items: ChatThreadRecord[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: ChatSource[];
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}

export interface ChatExchange {
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
}
