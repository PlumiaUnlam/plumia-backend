export type ChatSourceKind =
  | 'manuscript'
  | 'wiki'
  | 'timeline'
  | 'application_help';

/**
 * Parte concreta del editor a la que apunta un acceso directo. El frontend resuelve cada
 * valor (abre la pestaña o muestra la barra); la lista es cerrada y se valida al leer.
 */
export const CHAT_SECTIONS = [
  'editor-toolbar',
  'editor-right-wiki',
  'editor-right-chat',
  'editor-right-stats',
  'editor-right-review',
  'editor-history',
] as const;

export type ChatSection = (typeof CHAT_SECTIONS)[number];

export function isChatSection(value: unknown): value is ChatSection {
  return (
    typeof value === 'string' &&
    (CHAT_SECTIONS as readonly string[]).includes(value)
  );
}

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
  section?: ChatSection;
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
  section?: ChatSection;
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
