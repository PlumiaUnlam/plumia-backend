import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { ShareStatus } from '@prisma/client';
import type {
  Prisma,
  ReaderCommentStatus,
  SharePermission,
} from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  ManuscriptSnapshot,
  ReaderCommentView,
  ShareSummary,
  ShareViewerIdentity,
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

export const snapshotBookSelect = {
  id: true,
  title: true,
  project: { select: { id: true, title: true } },
  chapters: {
    where: { deletedAt: null },
    orderBy: { sortKey: 'asc' },
    select: {
      id: true,
      title: true,
      scenes: {
        where: { deletedAt: null },
        orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
        select: {
          id: true,
          title: true,
          content: true,
          wordCount: true,
        },
      },
    },
  },
} satisfies Prisma.BookSelect;

export const shareAccessSelect = {
  id: true,
  slug: true,
  tokenHash: true,
  invitedEmail: true,
  permission: true,
  status: true,
  acceptedById: true,
  expiresAt: true,
  isActive: true,
  createdAt: true,
  versionId: true,
  project: { select: { id: true, userId: true, deletedAt: true } },
  version: { select: { snapshot: true, createdAt: true } },
} satisfies Prisma.ShareLinkSelect;

export const commentThreadInclude = {
  author: {
    select: { id: true, displayName: true, name: true, email: true },
  },
  replies: {
    orderBy: { createdAt: 'asc' },
    include: {
      author: {
        select: { id: true, displayName: true, name: true, email: true },
      },
    },
  },
  statusEvents: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ReaderCommentInclude;

export type ShareAccessRecord = Prisma.ShareLinkGetPayload<{
  select: typeof shareAccessSelect;
}>;

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
  isVisible: boolean;
  displayName: string;
  author: {
    id: string;
    displayName: string | null;
    name: string;
    email: string;
  } | null;
  replies: Array<{
    id: string;
    body: string;
    displayName: string;
    author: {
      id: string;
      displayName: string | null;
      name: string;
      email: string;
    } | null;
    createdAt: Date;
  }>;
  statusEvents: Array<{
    status: ReaderCommentStatus;
    changedByName: string;
    createdAt: Date;
  }>;
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
    isVisible: comment.isVisible,
    author: {
      id: comment.author?.id ?? null,
      displayName:
        comment.author?.displayName ??
        comment.author?.name ??
        comment.author?.email ??
        comment.displayName,
    },
    replies: comment.replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      author: {
        id: reply.author?.id ?? null,
        displayName:
          reply.author?.displayName ??
          reply.author?.name ??
          reply.author?.email ??
          reply.displayName,
      },
      createdAt: reply.createdAt.toISOString(),
    })),
    statusHistory: comment.statusEvents.map((event) => ({
      status: event.status,
      changedByName: event.changedByName,
      createdAt: event.createdAt.toISOString(),
    })),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export async function findShareAccess(
  prisma: PrismaService,
  slug: string,
): Promise<ShareAccessRecord> {
  const share = await prisma.shareLink.findUnique({
    where: { slug },
    select: shareAccessSelect,
  });
  if (!share) {
    throw new NotFoundException('Share invitation not found');
  }
  return share;
}

export function assertShareActive(share: ShareAccessRecord): void {
  if (
    !share.isActive ||
    share.status === ShareStatus.REVOKED ||
    share.project.deletedAt
  ) {
    throw new GoneException('Share invitation is no longer active');
  }
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    throw new GoneException('Share invitation has expired');
  }
  if (!share.version?.snapshot) {
    throw new GoneException('Shared version is not available');
  }
}

export function assertViewerAccess(
  share: ShareAccessRecord,
  user: ShareViewerIdentity,
  token?: string,
): boolean {
  const isOwner = share.project.userId === user.id;
  if (isOwner) {
    return true;
  }
  assertShareActive(share);

  const hasLegacyAccountAccess =
    share.status === ShareStatus.ACCEPTED &&
    share.acceptedById === user.id &&
    Boolean(share.invitedEmail) &&
    share.invitedEmail === normalizeEmail(user.email);
  const hasLinkAccess =
    share.status === ShareStatus.ACCEPTED &&
    user.provider === 'google.com' &&
    user.emailVerified &&
    Boolean(share.invitedEmail) &&
    share.invitedEmail === normalizeEmail(user.email) &&
    typeof token === 'string' &&
    Boolean(share.tokenHash) &&
    tokenMatches(token, share.tokenHash ?? '');

  if (!hasLegacyAccountAccess && !hasLinkAccess) {
    throw new ForbiddenException('You do not have access to this version');
  }
  return false;
}
