export interface ChatSourceResponse {
  id: string;
  kind: string;
  chapterId?: string;
  sceneId?: string;
  textQuote?: string;
  route?: string;
}

export interface ChatMessageResponse {
  id: string;
  role: string;
  content: string;
  sources: ChatSourceResponse[];
  actions: Array<{
    kind: string;
    label: string;
    description: string;
    route: string;
  }>;
}

export interface ChatThreadResponse {
  id: string;
  projectId: string;
}

export interface ChatThreadPageResponse {
  items: ChatThreadResponse[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface ChatExchangeResponse {
  userMessage: ChatMessageResponse;
  assistantMessage: ChatMessageResponse;
}
