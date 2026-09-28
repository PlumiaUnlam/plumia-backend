import { GoneException } from '@nestjs/common';
import type {
  Prisma,
  ReaderCommentStatus,
  SharePermission,
  ShareStatus,
} from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  ManuscriptSnapshot,
  ReaderCommentView,
  ShareSummary,
} from './reading.types';

export const shareSummarySelect = {
  id: true,
  slug: true,
  invitedEmail: true,
  permission: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  version: { select: { createdAt: true } },
} satisfies Prisma.ShareLinkSelect;

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, expectedHash: string): boolean {
  const received = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function isSnapshotContent(value: Prisma.JsonValue | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseSnapshot(
  value: Prisma.JsonValue | null | undefined,
): ManuscriptSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoneException('Shared version is not available');
  }
  const candidate = value as unknown as ManuscriptSnapshot;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.projectId !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.books)
  ) {
    throw new GoneException('Shared version is invalid');
  }
  return candidate;
}

export function snapshotHasScene(
  snapshot: ManuscriptSnapshot,
  sceneId: string,
): boolean {
  return snapshot.books.some((book) =>
    book.chapters.some((chapter) =>
      chapter.scenes.some((scene) => scene.id === sceneId),
    ),
  );
}

export function toShareSummary(share: {
  id: string;
  slug: string;
  invitedEmail: string | null;
  permission: SharePermission;
  status: ShareStatus;
  expiresAt: Date | null;
  createdAt: Date;
  version: { createdAt: Date } | null;
}): ShareSummary {
  if (!share.invitedEmail || !share.version) {
    throw new GoneException('Share invitation is incomplete');
  }
  return {
    id: share.id,
    slug: share.slug,
    invitedEmail: share.invitedEmail,
    permission: share.permission,
    status: share.status,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    frozenAt: share.version.createdAt.toISOString(),
  };
}

export function toCommentView(comment: {
  id: string;
  snapshotSceneId: string | null;
  anchorFrom: number | null;
  anchorTo: number | null;
  selectedText: string | null;
  body: string;
  prefix: string | null;
  suffix: string | null;
  status: ReaderCommentStatus;
  displayName: string;
  author: {
    id: string;
    displayName: string | null;
    name: string;
    email: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}): ReaderCommentView {
  if (
    !comment.snapshotSceneId ||
    comment.anchorFrom === null ||
    comment.anchorTo === null ||
    comment.selectedText === null
  ) {
    throw new GoneException('Comment anchor is not available');
  }
  return {
    id: comment.id,
    snapshotSceneId: comment.snapshotSceneId,
    anchorFrom: comment.anchorFrom,
    anchorTo: comment.anchorTo,
    selectedText: comment.selectedText,
    body: comment.body,
    prefix: comment.prefix,
    suffix: comment.suffix,
    status: comment.status,
    author: {
      id: comment.author?.id ?? null,
      displayName:
        comment.author?.displayName ??
        comment.author?.name ??
        comment.author?.email ??
        comment.displayName,
    },
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
