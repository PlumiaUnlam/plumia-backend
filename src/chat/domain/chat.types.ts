export type ChatSourceKind =
  | 'manuscript'
  | 'wiki'
  | 'timeline'
  | 'application_help';

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
  cited?: boolean;
  primary?: boolean;
  chunkIndex?: number;
  contentHash?: string | null;
  textQuote?: string;
  route?: string;
}

export interface ChatOpenConflict {
  id: string;
  title: string;
  description: string | null;
  explanation: string | null;
  sceneId: string;
  entityName?: string;
  field?: string;
  currentValue?: string;
  observedValue?: string;
}

export interface ChatAction {
  id: string;
  kind: 'navigation';
  label: string;
  description: string;
  route: string;
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
  actions: ChatAction[];
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}

export interface ChatExchange {
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
}
