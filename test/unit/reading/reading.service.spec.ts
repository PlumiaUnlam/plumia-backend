import { ForbiddenException } from '@nestjs/common';
import {
  ReaderCommentStatus,
  SharePermission,
  ShareStatus,
} from '@prisma/client';
import { hashToken } from '../../../src/reading/reading.helpers';
import { ReadingService } from '../../../src/reading/reading.service';

describe('ReadingService', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const bookId = '20000000-0000-4000-8000-000000000001';
  const snapshot = {
    schemaVersion: 1,
    projectId: '10000000-0000-4000-8000-000000000001',
    title: 'Frozen book',
    frozenAt: now.toISOString(),
    books: [
      {
        id: bookId,
        title: 'Frozen book',
        chapters: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            title: 'Chapter one',
            scenes: [
              {
                id: '40000000-0000-4000-8000-000000000001',
                title: 'Scene one',
                content: { type: 'doc', content: [] },
                wordCount: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  const prisma = {
    book: { findFirst: jest.fn() },
    version: { create: jest.fn() },
    shareLink: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    readerComment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    readerCommentStatusEvent: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { generatePresignedGetUrl: jest.fn() };
  const service = new ReadingService(prisma as never, storage as never);
  const googleReader = {
    id: 'google-reader-id',
    email: 'reader@example.com',
    emailVerified: true,
    provider: 'google.com',
  };
  const owner = {
    id: 'owner-id',
    email: 'owner@example.com',
    emailVerified: false,
    provider: 'password',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  it('freezes the ordered manuscript before creating an email invitation', async () => {
    prisma.book.findFirst.mockResolvedValue({
      id: bookId,
      title: snapshot.title,
      project: { id: snapshot.projectId, title: 'Project' },
      chapters: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          title: 'Chapter one',
          scenes: [
            {
              id: '40000000-0000-4000-8000-000000000001',
              title: 'Scene one',
              content: {
                type: 'doc',
                content: [{ type: 'paragraph' }],
              },
              wordCount: 42,
            },
          ],
        },
      ],
    });
    prisma.version.create.mockResolvedValue({ id: 'version-id' });
    prisma.shareLink.create.mockImplementation(
      ({ data }: { data: { slug: string; invitedEmail: string } }) =>
        Promise.resolve({
          id: 'share-id',
          slug: data.slug,
          invitedEmail: data.invitedEmail,
          permission: SharePermission.COMMENT,
          status: ShareStatus.PENDING,
          expiresAt: null,
          createdAt: now,
          version: { createdAt: now },
        }),
    );

    const result = await service.createShare('owner-id', bookId, {
      email: ' Reader@Example.com ',
      permission: SharePermission.COMMENT,
    });

    expect(result.invitedEmail).toBe('reader@example.com');
    expect(result.token).toHaveLength(43);
    interface VersionCreateInput {
      data: {
        type: string;
        wordCount: number;
        sceneCount: number;
        snapshot: { title: string; books: unknown[] };
      };
    }
    const versionCalls = prisma.version.create.mock.calls as Array<
      [VersionCreateInput]
    >;
    const versionInput = versionCalls[0]?.[0];
    expect(versionInput).toBeDefined();
    if (!versionInput) {
      throw new Error('Version input was not captured');
    }
    expect(versionInput.data.type).toBe('shared');
    expect(versionInput.data.wordCount).toBe(42);
    expect(versionInput.data.sceneCount).toBe(1);
    expect(versionInput.data.snapshot.title).toBe('Frozen book');
    expect(versionInput.data.snapshot.books).toHaveLength(1);

    interface ShareCreateInput {
      data: {
        bookId: string;
        invitedEmail: string;
        permission: SharePermission;
        tokenHash: string;
      };
    }
    const shareCalls = prisma.shareLink.create.mock.calls as Array<
      [ShareCreateInput]
    >;
    const shareInput = shareCalls[0]?.[0];
    expect(shareInput).toBeDefined();
    if (!shareInput) {
      throw new Error('Share input was not captured');
    }
    expect(shareInput.data.invitedEmail).toBe('reader@example.com');
    expect(shareInput.data.bookId).toBe(bookId);
    expect(shareInput.data.permission).toBe(SharePermission.COMMENT);
    expect(shareInput.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts an invitation for the matching verified Google account', async () => {
    prisma.shareLink.findUnique
      .mockResolvedValueOnce(
        activeShare({ permission: SharePermission.COMMENT }),
      )
      .mockResolvedValueOnce(
        activeShare({
          permission: SharePermission.COMMENT,
          status: ShareStatus.ACCEPTED,
        }),
      );

    await expect(
      service.acceptInvitation(googleReader, 'share-slug', 'token'),
    ).resolves.toMatchObject({
      viewer: { isOwner: false, canComment: true },
    });
    interface ShareUpdateInput {
      where: { id: string };
      data: {
        status: ShareStatus;
        acceptedAt: Date;
        readerCount: { increment: number };
      };
    }
    const updateCalls = prisma.shareLink.update.mock.calls as Array<
      [ShareUpdateInput]
    >;
    const updateInput = updateCalls[0]?.[0];
    expect(updateInput).toBeDefined();
    if (!updateInput) {
      throw new Error('Share update was not captured');
    }
    expect(updateInput.where).toEqual({ id: 'share-id' });
    expect(updateInput.data.status).toBe(ShareStatus.ACCEPTED);
    expect(updateInput.data.acceptedAt).toBeInstanceOf(Date);
    expect(updateInput.data.readerCount).toEqual({ increment: 1 });
  });

  it('rejects an invitation with an invalid link token', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(activeShare());

    await expect(
      service.acceptInvitation(googleReader, 'share-slug', 'wrong-token'),
    ).rejects.toThrow(new ForbiddenException('Invalid invitation token'));
    expect(prisma.shareLink.update).not.toHaveBeenCalled();
  });

  it('rejects a Google account that does not match the invitation email', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(activeShare());

    await expect(
      service.acceptInvitation(
        { ...googleReader, email: 'other@example.com' },
        'share-slug',
        'token',
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'Sign in with the Google account that received this invitation',
      ),
    );
    expect(prisma.shareLink.update).not.toHaveBeenCalled();
  });

  it('lets the manuscript owner open the shared version and read comments without the invitation token', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({ permission: SharePermission.COMMENT }),
    );
    prisma.readerComment.findMany.mockResolvedValue([]);

    await expect(
      service.getSharedManuscript(owner, 'share-slug'),
    ).resolves.toMatchObject({
      viewer: { isOwner: true, canComment: true },
    });
    await expect(service.listComments(owner, 'share-slug')).resolves.toEqual(
      [],
    );
    expect(prisma.readerComment.findMany).toHaveBeenCalledTimes(1);
  });

  it('creates a review comment for a Google reader without a PlumIA account', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({
        permission: SharePermission.COMMENT,
        status: ShareStatus.ACCEPTED,
      }),
    );
    prisma.readerComment.create.mockResolvedValue({
      id: 'comment-id',
      snapshotSceneId: '40000000-0000-4000-8000-000000000001',
      anchorFrom: 1,
      anchorTo: 4,
      selectedText: 'The',
      body: 'Comment',
      prefix: null,
      suffix: null,
      status: ReaderCommentStatus.OPEN,
      isVisible: true,
      displayName: 'reader@example.com',
      author: null,
      replies: [],
      statusEvents: [],
      createdAt: now,
      updatedAt: now,
    });
    prisma.readerComment.findUniqueOrThrow.mockResolvedValue({
      id: 'comment-id',
      snapshotSceneId: '40000000-0000-4000-8000-000000000001',
      anchorFrom: 1,
      anchorTo: 4,
      selectedText: 'The',
      body: 'Comment',
      prefix: null,
      suffix: null,
      status: ReaderCommentStatus.OPEN,
      isVisible: true,
      displayName: 'reader@example.com',
      author: null,
      replies: [],
      statusEvents: [],
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.createComment(
      googleReader,
      'share-slug',
      'token',
      {
        snapshotSceneId: '40000000-0000-4000-8000-000000000001',
        anchorFrom: 1,
        anchorTo: 4,
        selectedText: 'The',
        body: 'Comment',
      },
    );

    interface CommentCreateInput {
      data: { authorUserId: string | null; displayName: string };
    }
    const createCalls = prisma.readerComment.create.mock.calls as Array<
      [CommentCreateInput]
    >;
    const createInput = createCalls[0]?.[0];
    expect(createInput?.data).toMatchObject({
      authorUserId: null,
      displayName: 'reader@example.com',
    });
    expect(result.author).toEqual({
      id: null,
      displayName: 'reader@example.com',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: googleReader.id },
      select: { id: true, displayName: true, name: true, email: true },
    });
  });

  it('prevents a read-only recipient from creating comments', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({
        permission: SharePermission.READ_ONLY,
        status: ShareStatus.ACCEPTED,
        acceptedById: 'reader-id',
      }),
    );

    await expect(
      service.createComment(googleReader, 'share-slug', 'token', {
        snapshotSceneId: '40000000-0000-4000-8000-000000000001',
        anchorFrom: 1,
        anchorTo: 4,
        selectedText: 'The',
        body: 'Comment',
      }),
    ).rejects.toThrow(new ForbiddenException('This invitation is read-only'));
    expect(prisma.readerComment.create).not.toHaveBeenCalled();

    await expect(
      service.createComment(owner, 'share-slug', undefined, {
        snapshotSceneId: '40000000-0000-4000-8000-000000000001',
        anchorFrom: 1,
        anchorTo: 4,
        selectedText: 'The',
        body: 'Owner comment',
      }),
    ).rejects.toThrow(new ForbiddenException('This invitation is read-only'));
    expect(prisma.readerComment.create).not.toHaveBeenCalled();
  });

  function activeShare(
    overrides: Partial<{
      permission: SharePermission;
      status: ShareStatus;
      acceptedById: string | null;
    }> = {},
  ): Record<string, unknown> {
    return {
      id: 'share-id',
      slug: 'share-slug',
      tokenHash: hashToken('token'),
      invitedEmail: 'reader@example.com',
      permission: overrides.permission ?? SharePermission.COMMENT,
      status: overrides.status ?? ShareStatus.PENDING,
      acceptedById: overrides.acceptedById ?? null,
      expiresAt: null,
      isActive: true,
      createdAt: now,
      versionId: 'version-id',
      project: {
        id: snapshot.projectId,
        userId: 'owner-id',
        deletedAt: null,
      },
      version: { snapshot, createdAt: now },
    };
  }
});
