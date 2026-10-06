import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import {
  ReaderCommentStatus,
  SharePermission,
  ShareStatus,
} from '@prisma/client';
import { hashToken } from '../../../src/reading/reading.helpers';
import { ReadingService } from '../../../src/reading/reading.service';

describe('ReadingService endpoint flows', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const sceneId = '40000000-0000-4000-8000-000000000001';
  const snapshot = {
    schemaVersion: 1,
    projectId: '10000000-0000-4000-8000-000000000001',
    title: 'Frozen book',
    frozenAt: now.toISOString(),
    books: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Frozen book',
        chapters: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            title: 'Chapter one',
            scenes: [
              {
                id: sceneId,
                title: 'Scene one',
                content: { type: 'doc', content: [] },
                wordCount: 12,
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
      updateMany: jest.fn(),
    },
    readerCommentReply: { create: jest.fn() },
    readerCommentStatusEvent: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { generatePresignedGetUrl: jest.fn() };
  const service = new ReadingService(prisma as never, storage as never);
  const reader = {
    id: 'reader-id',
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
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  function firstMockArgument(mock: jest.Mock, callIndex = 0): unknown {
    const calls = mock.mock.calls as Array<[unknown]>;
    return calls[callIndex]?.[0];
  }

  it('requires accepted link access and filters comments without usable text anchors', async () => {
    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
    );
    await expect(
      service.getSharedManuscript(reader, 'share-slug'),
    ).resolves.toMatchObject({
      manuscript: { title: 'Frozen book' },
      viewer: { isOwner: false, canComment: true },
    });

    prisma.shareLink.findUnique.mockResolvedValueOnce(activeShare());
    await expect(
      service.getSharedManuscript(reader, 'share-slug', 'token'),
    ).rejects.toThrow(
      new ForbiddenException('You do not have access to this version'),
    );

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
    );
    prisma.readerComment.findMany.mockResolvedValue([
      commentRecord({ anchorFrom: null }),
      commentRecord(),
    ]);
    const comments = await service.listComments(reader, 'share-slug');
    expect(comments).toHaveLength(1);
    const listInput = firstMockArgument(prisma.readerComment.findMany) as {
      where: { isVisible: boolean };
    };
    expect(listInput.where.isVisible).toBe(true);
  });

  it('blocks readers from listing comments on read-only shares and returns empty for legacy shares', async () => {
    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({
        permission: SharePermission.READ_ONLY,
        status: ShareStatus.ACCEPTED,
        acceptedById: reader.id,
      }),
    );
    await expect(
      service.listComments(reader, 'share-slug', 'token'),
    ).rejects.toThrow(new ForbiddenException('This invitation is read-only'));

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ versionId: null }),
    );
    await expect(service.listComments(owner, 'share-slug')).resolves.toEqual(
      [],
    );
    expect(prisma.readerComment.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      activeShare({
        permission: SharePermission.READ_ONLY,
        status: ShareStatus.ACCEPTED,
        acceptedById: reader.id,
      }),
      reader,
      undefined,
      { anchorFrom: 0, anchorTo: 1 },
      new ForbiddenException('This invitation is read-only'),
    ],
    [
      activeShare({ versionId: null }),
      owner,
      undefined,
      { anchorFrom: 0, anchorTo: 1 },
      new GoneException('Shared version is not available'),
    ],
    [
      activeShare(),
      owner,
      undefined,
      { anchorFrom: 1, anchorTo: 1 },
      new BadRequestException('Invalid text selection'),
    ],
    [
      activeShare(),
      owner,
      undefined,
      { snapshotSceneId: 'missing-scene', anchorFrom: 0, anchorTo: 1 },
      new BadRequestException('Scene does not belong to this version'),
    ],
  ])(
    'rejects invalid comment creation flows',
    async (share, user, token, fields, error) => {
      prisma.shareLink.findUnique.mockResolvedValue(share);
      await expect(
        service.createComment(user, 'share-slug', token, {
          snapshotSceneId: sceneId,
          selectedText: 'A',
          body: 'Comment',
          ...fields,
        }),
      ).rejects.toThrow(error);
      expect(prisma.readerComment.create).not.toHaveBeenCalled();
    },
  );

  it('creates an anchored comment for an account reader and records an open status event', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: reader.id,
      displayName: null,
      name: 'Reader Name',
      email: reader.email,
    });
    prisma.readerComment.create.mockResolvedValue({ id: 'comment-1' });
    prisma.readerComment.findUniqueOrThrow.mockResolvedValue(
      commentRecord({
        displayName: 'Reader Name',
        body: 'A comment',
        selectedText: 'selected',
      }),
    );

    await expect(
      service.createComment(reader, 'share-slug', undefined, {
        snapshotSceneId: sceneId,
        anchorFrom: 2,
        anchorTo: 10,
        selectedText: ' selected ',
        body: ' A comment ',
        prefix: ' before ',
        suffix: ' after ',
      }),
    ).resolves.toMatchObject({ author: { displayName: 'Reader Name' } });
    const createInput = firstMockArgument(prisma.readerComment.create) as {
      data: {
        body: string;
        selectedText: string;
        prefix: string;
        suffix: string;
        displayName: string;
      };
    };
    expect(createInput.data).toMatchObject({
      body: 'A comment',
      selectedText: 'selected',
      prefix: 'before',
      suffix: 'after',
      displayName: 'Reader Name',
    });
    const statusEvent = firstMockArgument(
      prisma.readerCommentStatusEvent.create,
    ) as { data: { status: ReaderCommentStatus } };
    expect(statusEvent.data.status).toBe(ReaderCommentStatus.OPEN);
  });

  it('supports owner comments without an invitation email and uses the guest fallback name', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({ invitedEmail: null }),
    );
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.readerComment.create.mockResolvedValue({ id: 'comment-1' });
    prisma.readerComment.findUniqueOrThrow.mockResolvedValue(
      commentRecord({ displayName: 'Lector invitado' }),
    );

    await expect(
      service.createComment(owner, 'share-slug', undefined, {
        snapshotSceneId: sceneId,
        anchorFrom: 0,
        anchorTo: 1,
        selectedText: 'A',
        body: 'Comment',
      }),
    ).resolves.toMatchObject({ author: { displayName: 'Lector invitado' } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: owner.id } }),
    );
  });

  it('replies to visible comments and rejects missing or read-only comment threads', async () => {
    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
    );
    prisma.readerComment.findFirst.mockResolvedValue({ id: 'comment-1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.readerComment.findUniqueOrThrow.mockResolvedValue(
      commentRecord({
        replies: [
          {
            id: 'reply-1',
            body: 'Reply',
            displayName: reader.email,
            author: null,
            createdAt: now,
          },
        ],
      }),
    );

    await expect(
      service.replyToComment(reader, 'share-slug', 'comment-1', undefined, {
        body: ' Reply ',
      }),
    ).resolves.toMatchObject({
      replies: [{ body: 'Reply', author: { displayName: reader.email } }],
    });
    const commentSearch = firstMockArgument(prisma.readerComment.findFirst) as {
      where: { isVisible: boolean };
    };
    expect(commentSearch.where.isVisible).toBe(true);

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
    );
    prisma.readerComment.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.replyToComment(reader, 'share-slug', 'missing', 'token', {
        body: 'Reply',
      }),
    ).rejects.toThrow(new NotFoundException('Comment not found'));

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({
        permission: SharePermission.READ_ONLY,
        status: ShareStatus.ACCEPTED,
        acceptedById: reader.id,
      }),
    );
    await expect(
      service.replyToComment(reader, 'share-slug', 'comment-1', 'token', {
        body: 'Reply',
      }),
    ).rejects.toThrow(new ForbiddenException('This invitation is read-only'));
  });

  it('lets only the owner resolve comments and records only actual status changes', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(activeShare());
    prisma.user.findUnique.mockResolvedValue({
      displayName: null,
      name: 'Owner Name',
      email: owner.email,
    });
    prisma.readerComment.findFirst.mockResolvedValue({ id: 'comment-1' });
    prisma.readerComment.updateMany.mockResolvedValue({ count: 1 });
    prisma.readerComment.findUniqueOrThrow.mockResolvedValue(
      commentRecord({
        status: ReaderCommentStatus.RESOLVED,
      }),
    );

    await expect(
      service.updateComment(owner, 'share-slug', 'comment-1', {
        status: ReaderCommentStatus.RESOLVED,
      }),
    ).resolves.toMatchObject({ status: ReaderCommentStatus.RESOLVED });
    const statusEvent = firstMockArgument(
      prisma.readerCommentStatusEvent.create,
    ) as { data: { changedByName: string } };
    expect(statusEvent.data.changedByName).toBe('Owner Name');
    const updateInput = firstMockArgument(prisma.readerComment.updateMany) as {
      data: { resolvedById: string; resolvedAt: Date };
    };
    expect(updateInput.data.resolvedById).toBe(owner.id);
    expect(updateInput.data.resolvedAt).toBeInstanceOf(Date);

    prisma.readerComment.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.readerCommentStatusEvent.create.mockClear();
    await service.updateComment(owner, 'share-slug', 'comment-1', {
      status: ReaderCommentStatus.RESOLVED,
    });
    expect(prisma.readerCommentStatusEvent.create).not.toHaveBeenCalled();
  });

  it('rejects resolving another owner’s comment, expired shares, and absent comments', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(activeShare());
    await expect(
      service.updateComment(reader, 'share-slug', 'comment-1', {
        status: ReaderCommentStatus.RESOLVED,
      }),
    ).rejects.toThrow(
      new ForbiddenException('Only the manuscript owner can resolve comments'),
    );

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
    );
    await expect(
      service.updateComment(reader, 'share-slug', 'comment-1', {
        status: ReaderCommentStatus.RESOLVED,
      }),
    ).rejects.toThrow(new GoneException('Share invitation has expired'));

    prisma.shareLink.findUnique.mockResolvedValueOnce(activeShare());
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.readerComment.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateComment(owner, 'share-slug', 'missing', {
        status: ReaderCommentStatus.RESOLVED,
      }),
    ).rejects.toThrow(new NotFoundException('Comment not found'));
  });

  it('signs URLs only for scene assets that belong to the frozen version', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(activeShare());
    storage.generatePresignedGetUrl.mockResolvedValue(
      'https://storage.test/url',
    );

    await expect(
      service.getSharedStorageUrl(
        owner,
        'share-slug',
        `scenes/${sceneId}/image.png`,
      ),
    ).resolves.toBe('https://storage.test/url');
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      `scenes/${sceneId}/image.png`,
    );

    await expect(
      service.getSharedStorageUrl(owner, 'share-slug', 'projects/private.png'),
    ).rejects.toThrow(
      new ForbiddenException('Storage object is not part of this version'),
    );
    await expect(
      service.getSharedStorageUrl(
        owner,
        'share-slug',
        'scenes/50000000-0000-4000-8000-000000000001/image.png',
      ),
    ).rejects.toThrow(
      new ForbiddenException('Storage object is not part of this version'),
    );
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledTimes(1);
  });

  function shareSummary(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'share-id',
      slug: 'share-slug',
      invitedEmail: 'reader@example.com',
      permission: SharePermission.COMMENT,
      status: ShareStatus.PENDING,
      expiresAt: null,
      createdAt: now,
      version: { createdAt: now },
      ...overrides,
    };
  }

  function activeShare(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...shareSummary(),
      tokenHash: hashToken('token'),
      acceptedById: null,
      isActive: true,
      versionId: 'version-id',
      project: { id: snapshot.projectId, userId: owner.id, deletedAt: null },
      version: { snapshot, createdAt: now },
      ...overrides,
    };
  }

  function commentRecord(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'comment-1',
      snapshotSceneId: sceneId,
      anchorFrom: 0,
      anchorTo: 1,
      selectedText: 'A',
      body: 'Comment',
      prefix: null,
      suffix: null,
      status: ReaderCommentStatus.OPEN,
      isVisible: true,
      displayName: 'Reader',
      author: null,
      replies: [],
      statusEvents: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }
});
