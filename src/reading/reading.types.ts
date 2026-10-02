import type {
  ReaderCommentStatus,
  SharePermission,
  ShareStatus,
} from '@prisma/client';

export type SnapshotContent = Record<string, unknown>;

export interface ShareViewerIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
  provider: string;
}

export interface SnapshotScene {
  id: string;
  title: string | null;
  content: SnapshotContent | null;
  wordCount: number;
}

export interface SnapshotChapter {
  id: string;
  title: string;
  scenes: SnapshotScene[];
}

export interface SnapshotBook {
  id: string;
  title: string;
  chapters: SnapshotChapter[];
}

export interface ManuscriptSnapshot {
  schemaVersion: 1;
  projectId: string;
  title: string;
  frozenAt: string;
  books: SnapshotBook[];
}

export interface ShareSummary {
  id: string;
  slug: string;
  invitedEmail: string;
  permission: SharePermission;
  status: ShareStatus;
  expiresAt: string | null;
  createdAt: string;
  frozenAt: string;
}

export interface CreatedShare extends ShareSummary {
  token: string;
}

export interface SharedManuscriptView {
  invitation: ShareSummary;
  manuscript: ManuscriptSnapshot;
  viewer: {
    isOwner: boolean;
    canComment: boolean;
  };
}

export interface ReaderCommentView {
  id: string;
  snapshotSceneId: string;
  anchorFrom: number;
  anchorTo: number;
  selectedText: string;
  body: string;
  prefix: string | null;
  suffix: string | null;
  status: ReaderCommentStatus;
  isVisible: boolean;
  replies: ReaderCommentReplyView[];
  statusHistory: ReaderCommentStatusEventView[];
  author: {
    id: string | null;
    displayName: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ReaderCommentReplyView {
  id: string;
  body: string;
  author: {
    id: string | null;
    displayName: string;
  };
  createdAt: string;
}

export interface ReaderCommentStatusEventView {
  status: ReaderCommentStatus;
  changedByName: string;
  createdAt: string;
}
