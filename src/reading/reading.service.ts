import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReaderCommentStatus,
  SharePermission,
  ShareStatus,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { createContentHash } from '../manuscript/domain/json-content';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateReaderCommentDto } from './dto/create-reader-comment.dto';
import { CreateReaderCommentReplyDto } from './dto/create-reader-comment-reply.dto';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateReaderCommentDto } from './dto/update-reader-comment.dto';
import { UpdateShareDto } from './dto/update-share.dto';
import {
  assertShareActive,
  assertViewerAccess,
  commentThreadInclude,
  findShareAccess,
  hashToken,
  isSnapshotContent,
  normalizeEmail,
  parseSnapshot,
  shareSummarySelect,
  snapshotBookSelect,
  snapshotHasScene,
  tokenMatches,
  toCommentView,
  toShareSummary,
} from './reading.helpers';
import type {
  CreatedShare,
  ManuscriptSnapshot,
  ReaderCommentView,
  ShareViewerIdentity,
  ShareSummary,
  SharedManuscriptView,
  SnapshotContent,
} from './reading.types';

@Injectable()
export class ReadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createShare(
    userId: string,
    bookId: string,
    dto: CreateShareDto,
  ): Promise<CreatedShare> {
    const book = await this.prisma.book.findFirst({
      where: {
        id: bookId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: snapshotBookSelect,
    });

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    const invitedEmail = normalizeEmail(dto.email);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration must be in the future');
    }

    const frozenAt = new Date();
    const snapshot: ManuscriptSnapshot = {
      schemaVersion: 1,
      projectId: book.project.id,
      title: book.title,
      frozenAt: frozenAt.toISOString(),
      books: [
        {
          id: book.id,
          title: book.title,
          chapters: book.chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            scenes: chapter.scenes.map((scene) => ({
              id: scene.id,
              title: scene.title,
              content: isSnapshotContent(scene.content)
                ? (scene.content as SnapshotContent)
                : null,
              wordCount: scene.wordCount,
            })),
          })),
        },
      ],
    };

    const scenes = snapshot.books.flatMap((book) =>
      book.chapters.flatMap((chapter) => chapter.scenes),
    );
    const token = randomBytes(32).toString('base64url');
    const slug = randomUUID();

    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.version.create({
        data: {
          projectId: book.project.id,
          label: `${book.title} · versión compartida ${frozenAt.toISOString()}`,
          type: 'shared',
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          checksumSha256: createContentHash(
            snapshot as unknown as Record<string, unknown>,
          ),
          wordCount: scenes.reduce(
            (total, scene) => total + scene.wordCount,
            0,
          ),
          sceneCount: scenes.length,
        },
      });

      return tx.shareLink.create({
        data: {
          projectId: book.project.id,
          bookId,
          versionId: version.id,
          slug,
          tokenHash: hashToken(token),
          invitedEmail,
          permission: dto.permission,
          status: ShareStatus.PENDING,
          createdById: userId,
          expiresAt,
          allowComments: dto.permission === SharePermission.COMMENT,
        },
        select: shareSummarySelect,
      });
    });

    return { ...toShareSummary(created), token };
  }

  async listBookShares(
    userId: string,
    bookId: string,
  ): Promise<ShareSummary[]> {
    await this.assertBookOwner(userId, bookId);
    const shares = await this.prisma.shareLink.findMany({
      where: { bookId },
      orderBy: { createdAt: 'desc' },
      select: shareSummarySelect,
    });
    return shares.flatMap((share) =>
      share.invitedEmail && share.version ? [toShareSummary(share)] : [],
    );
  }

  async updateShare(
    userId: string,
    bookId: string,
    shareId: string,
    dto: UpdateShareDto,
  ): Promise<ShareSummary> {
    await this.assertBookOwner(userId, bookId);
    const result = await this.prisma.shareLink.updateMany({
      where: { id: shareId, bookId, status: { not: ShareStatus.REVOKED } },
      data: {
        permission: dto.permission,
        allowComments: dto.permission === SharePermission.COMMENT,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Share invitation not found');
    }
    const share = await this.prisma.shareLink.findUnique({
      where: { id: shareId },
      select: shareSummarySelect,
    });
    if (!share) {
      throw new NotFoundException('Share invitation not found');
    }
    return toShareSummary(share);
  }

  async revokeShare(
    userId: string,
    bookId: string,
    shareId: string,
  ): Promise<void> {
    await this.assertBookOwner(userId, bookId);
    const result = await this.prisma.shareLink.updateMany({
      where: { id: shareId, bookId, status: { not: ShareStatus.REVOKED } },
      data: {
        status: ShareStatus.REVOKED,
        isActive: false,
        revokedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Share invitation not found');
    }
  }

  async acceptInvitation(
    user: ShareViewerIdentity,
    slug: string,
    token: string,
  ): Promise<SharedManuscriptView> {
    const share = await findShareAccess(this.prisma, slug);
    if (share.project.userId === user.id) {
      return this.getSharedManuscript(user, slug);
    }
    assertShareActive(share);
    if (!share.tokenHash || !tokenMatches(token, share.tokenHash)) {
      throw new ForbiddenException('Invalid invitation token');
    }
    if (
      user.provider !== 'google.com' ||
      !user.emailVerified ||
      !share.invitedEmail ||
      normalizeEmail(user.email) !== share.invitedEmail
    ) {
      throw new ForbiddenException(
        'Sign in with the Google account that received this invitation',
      );
    }

    if (share.status !== ShareStatus.ACCEPTED) {
      await this.prisma.shareLink.update({
        where: { id: share.id },
        data: {
          status: ShareStatus.ACCEPTED,
          acceptedAt: new Date(),
          readerCount: { increment: 1 },
        },
      });
    }

    return this.getSharedManuscript(user, slug, token);
  }

  async getSharedManuscript(
    user: ShareViewerIdentity,
    slug: string,
    token?: string,
  ): Promise<SharedManuscriptView> {
    const share = await findShareAccess(this.prisma, slug);
    const isOwner = assertViewerAccess(share, user, token);
    return {
      invitation: toShareSummary(share),
      manuscript: parseSnapshot(share.version?.snapshot),
      viewer: {
        isOwner,
        canComment: share.permission === SharePermission.COMMENT,
      },
    };
  }

  async listComments(
    user: ShareViewerIdentity,
    slug: string,
    token?: string,
  ): Promise<ReaderCommentView[]> {
    const share = await findShareAccess(this.prisma, slug);
    const isOwner = assertViewerAccess(share, user, token);
    if (!isOwner && share.permission !== SharePermission.COMMENT) {
      throw new ForbiddenException('This invitation is read-only');
    }
    if (!share.versionId) {
      return [];
    }

    const comments = await this.prisma.readerComment.findMany({
      where: {
        versionId: share.versionId,
        ...(isOwner ? {} : { isVisible: true }),
        snapshotSceneId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      include: commentThreadInclude,
    });

    return comments.flatMap((comment) => {
      if (
        !comment.snapshotSceneId ||
        comment.anchorFrom === null ||
        comment.anchorTo === null ||
        comment.selectedText === null
      ) {
        return [];
      }
      return [toCommentView(comment)];
    });
  }

  async createComment(
    user: ShareViewerIdentity,
    slug: string,
    token: string | undefined,
    dto: CreateReaderCommentDto,
  ): Promise<ReaderCommentView> {
    const share = await findShareAccess(this.prisma, slug);
    const isOwner = assertViewerAccess(share, user, token);
    assertShareActive(share);
    if (share.permission !== SharePermission.COMMENT) {
      throw new ForbiddenException('This invitation is read-only');
    }
    if (!share.versionId) {
      throw new GoneException('Shared version is not available');
    }
    if (dto.anchorTo <= dto.anchorFrom) {
      throw new BadRequestException('Invalid text selection');
    }
    const snapshot = parseSnapshot(share.version?.snapshot);
    if (!snapshotHasScene(snapshot, dto.snapshotSceneId)) {
      throw new BadRequestException('Scene does not belong to this version');
    }

    const accountIdentityUser =
      isOwner ||
      (share.invitedEmail !== null &&
        normalizeEmail(user.email) === share.invitedEmail)
        ? user
        : null;
    const author = accountIdentityUser
      ? await this.prisma.user.findUnique({
          where: { id: accountIdentityUser.id },
          select: { id: true, displayName: true, name: true, email: true },
        })
      : null;
    const displayName =
      author?.displayName ??
      author?.name ??
      author?.email ??
      share.invitedEmail ??
      'Lector invitado';

    const commentId = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.readerComment.create({
        data: {
          shareLinkId: share.id,
          versionId: share.versionId,
          snapshotSceneId: dto.snapshotSceneId,
          authorUserId: author?.id ?? null,
          displayName,
          body: dto.body.trim(),
          anchorFrom: dto.anchorFrom,
          anchorTo: dto.anchorTo,
          selectedText: dto.selectedText.trim(),
          prefix: dto.prefix?.trim() ?? null,
          suffix: dto.suffix?.trim() ?? null,
          isVisible: true,
        },
        select: { id: true },
      });

      await tx.readerCommentStatusEvent.create({
        data: {
          commentId: comment.id,
          status: ReaderCommentStatus.OPEN,
          changedById: author?.id ?? null,
          changedByName: displayName,
        },
      });
      return comment.id;
    });
    const comment = await this.prisma.readerComment.findUniqueOrThrow({
      where: { id: commentId },
      include: commentThreadInclude,
    });
    return toCommentView(comment);
  }

  async replyToComment(
    user: ShareViewerIdentity,
    slug: string,
    commentId: string,
    token: string | undefined,
    dto: CreateReaderCommentReplyDto,
  ): Promise<ReaderCommentView> {
    const share = await findShareAccess(this.prisma, slug);
    const isOwner = assertViewerAccess(share, user, token);
    if (!isOwner && share.permission !== SharePermission.COMMENT) {
      throw new ForbiddenException('This invitation is read-only');
    }
    if (!share.versionId) {
      throw new GoneException('Shared version is not available');
    }

    const existing = await this.prisma.readerComment.findFirst({
      where: {
        id: commentId,
        shareLinkId: share.id,
        versionId: share.versionId,
        ...(isOwner ? {} : { isVisible: true }),
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const author = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, displayName: true, name: true, email: true },
    });
    const displayName =
      author?.displayName ?? author?.name ?? author?.email ?? user.email;

    await this.prisma.readerCommentReply.create({
      data: {
        commentId,
        authorId: author?.id ?? null,
        displayName,
        body: dto.body.trim(),
      },
    });
    const comment = await this.prisma.readerComment.findUniqueOrThrow({
      where: { id: commentId },
      include: commentThreadInclude,
    });
    return toCommentView(comment);
  }

  async updateComment(
    user: { id: string; email: string },
    slug: string,
    commentId: string,
    dto: UpdateReaderCommentDto,
  ): Promise<ReaderCommentView> {
    const share = await findShareAccess(this.prisma, slug);
    const isOwner = share.project.userId === user.id;
    if (!isOwner) {
      assertShareActive(share);
      throw new ForbiddenException(
        'Only the manuscript owner can resolve comments',
      );
    }
    if (!share.versionId) {
      throw new GoneException('Shared version is not available');
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true, name: true, email: true },
    });
    const changedByName =
      owner?.displayName ?? owner?.name ?? owner?.email ?? user.email;
    const comment = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.readerComment.findFirst({
        where: {
          id: commentId,
          shareLinkId: share.id,
          versionId: share.versionId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Comment not found');
      }

      const changed = await tx.readerComment.updateMany({
        where: { id: commentId, status: { not: dto.status } },
        data: {
          status: dto.status,
          resolvedAt:
            dto.status === ReaderCommentStatus.RESOLVED ? new Date() : null,
          resolvedById:
            dto.status === ReaderCommentStatus.RESOLVED ? user.id : null,
        },
      });
      if (changed.count > 0) {
        await tx.readerCommentStatusEvent.create({
          data: {
            commentId,
            status: dto.status,
            changedById: user.id,
            changedByName,
          },
        });
      }
      return tx.readerComment.findUniqueOrThrow({
        where: { id: commentId },
        include: commentThreadInclude,
      });
    });
    return toCommentView(comment);
  }

  async getSharedStorageUrl(
    user: ShareViewerIdentity,
    slug: string,
    storageKey: string,
    token?: string,
  ): Promise<string> {
    const share = await findShareAccess(this.prisma, slug);
    assertViewerAccess(share, user, token);
    const snapshot = parseSnapshot(share.version?.snapshot);
    const match = /^scenes\/([0-9a-f-]{36})\//i.exec(storageKey);
    if (!match?.[1] || !snapshotHasScene(snapshot, match[1])) {
      throw new ForbiddenException(
        'Storage object is not part of this version',
      );
    }
    return this.storage.generatePresignedGetUrl(storageKey);
  }

  private async assertBookOwner(userId: string, bookId: string): Promise<void> {
    const book = await this.prisma.book.findFirst({
      where: {
        id: bookId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!book) {
      throw new NotFoundException('Book not found');
    }
  }
}
