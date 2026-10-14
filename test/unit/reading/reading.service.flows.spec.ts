import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { SharePermission, ShareStatus } from '@prisma/client';
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

  it('rejects an unknown book and an invitation expiration in the past', async () => {
    prisma.book.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.createShare('owner-id', 'book-id', {
        email: 'reader@example.com',
        permission: SharePermission.READ_ONLY,
      }),
    ).rejects.toThrow(new NotFoundException('Book not found'));

    prisma.book.findFirst.mockResolvedValueOnce(bookRecord());
    await expect(
      service.createShare('owner-id', 'book-id', {
        email: 'reader@example.com',
        permission: SharePermission.READ_ONLY,
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(
      new BadRequestException('Expiration must be in the future'),
    );
    expect(prisma.version.create).not.toHaveBeenCalled();
  });

  it('creates a read-only share with a future expiry and drops invalid snapshot content', async () => {
    prisma.book.findFirst.mockResolvedValue(
      bookRecord([
        {
          id: sceneId,
          title: 'Scene one',
          content: ['not', 'a', 'document'],
          wordCount: 12,
        },
      ]),
    );
    prisma.version.create.mockResolvedValue({ id: 'version-id' });
    prisma.shareLink.create.mockResolvedValue(shareSummary());

    const result = await service.createShare('owner-id', 'book-id', {
      email: ' Reader@Example.com ',
      permission: SharePermission.READ_ONLY,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(result.invitedEmail).toBe('reader@example.com');
    expect(result.token).toHaveLength(43);
    const versionInput = firstMockArgument(prisma.version.create) as {
      data: {
        snapshot: { books: Array<{ chapters: Array<{ scenes: unknown[] }> }> };
        sceneCount: number;
        wordCount: number;
      };
    };
    expect(
      versionInput.data.snapshot.books[0]?.chapters[0]?.scenes[0],
    ).toMatchObject({
      content: null,
      wordCount: 12,
    });
    expect(versionInput.data.sceneCount).toBe(1);
    expect(versionInput.data.wordCount).toBe(12);
    const shareInput = firstMockArgument(prisma.shareLink.create) as {
      data: {
        permission: SharePermission;
        allowComments: boolean;
        expiresAt: Date;
      };
    };
    expect(shareInput.data).toMatchObject({
      permission: SharePermission.READ_ONLY,
      allowComments: false,
    });
    expect(shareInput.data.expiresAt).toEqual(
      new Date('2099-01-01T00:00:00.000Z'),
    );
  });

  it('lists only complete invitations and rejects access to another owner’s book', async () => {
    prisma.book.findFirst.mockResolvedValue({ id: 'book-id' });
    prisma.shareLink.findMany.mockResolvedValue([
      shareSummary(),
      { ...shareSummary(), invitedEmail: null },
      { ...shareSummary(), version: null },
    ]);

    await expect(
      service.listBookShares('owner-id', 'book-id'),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'share-id',
        invitedEmail: 'reader@example.com',
      }),
    ]);
    expect(prisma.shareLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bookId: 'book-id' } }),
    );

    prisma.book.findFirst.mockResolvedValue(null);
    await expect(
      service.listBookShares('someone-else', 'book-id'),
    ).rejects.toThrow(new NotFoundException('Book not found'));
  });

  it('updates share permission and reports missing or concurrently removed invitations', async () => {
    prisma.book.findFirst.mockResolvedValue({ id: 'book-id' });
    prisma.shareLink.updateMany.mockResolvedValue({ count: 1 });
    prisma.shareLink.findUnique.mockResolvedValue(shareSummary());

    await expect(
      service.updateShare('owner-id', 'book-id', 'share-id', {
        permission: SharePermission.READ_ONLY,
      }),
    ).resolves.toMatchObject({ id: 'share-id' });
    expect(prisma.shareLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { permission: SharePermission.READ_ONLY, allowComments: false },
      }),
    );

    prisma.shareLink.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.updateShare('owner-id', 'book-id', 'missing', {
        permission: SharePermission.COMMENT,
      }),
    ).rejects.toThrow(new NotFoundException('Share invitation not found'));

    prisma.shareLink.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.shareLink.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.updateShare('owner-id', 'book-id', 'share-id', {
        permission: SharePermission.COMMENT,
      }),
    ).rejects.toThrow(new NotFoundException('Share invitation not found'));
  });

  it('revokes an active share and reports a missing share', async () => {
    prisma.book.findFirst.mockResolvedValue({ id: 'book-id' });
    prisma.shareLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      service.revokeShare('owner-id', 'book-id', 'share-id'),
    ).resolves.toBeUndefined();
    const updateInput = firstMockArgument(prisma.shareLink.updateMany) as {
      data: { status: ShareStatus; isActive: boolean; revokedAt: Date };
    };
    expect(updateInput.data).toMatchObject({
      status: ShareStatus.REVOKED,
      isActive: false,
    });
    expect(updateInput.data.revokedAt).toBeInstanceOf(Date);

    prisma.shareLink.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.revokeShare('owner-id', 'book-id', 'missing'),
    ).rejects.toThrow(new NotFoundException('Share invitation not found'));
  });

  it('lets the owner open a share without accepting it and avoids incrementing an already accepted reader', async () => {
    prisma.shareLink.findUnique
      .mockResolvedValueOnce(activeShare())
      .mockResolvedValueOnce(activeShare())
      .mockResolvedValueOnce(
        activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
      )
      .mockResolvedValueOnce(
        activeShare({ status: ShareStatus.ACCEPTED, acceptedById: reader.id }),
      );

    await expect(
      service.acceptInvitation(owner, 'share-slug', 'unused-token'),
    ).resolves.toMatchObject({ viewer: { isOwner: true } });
    await expect(
      service.acceptInvitation(reader, 'share-slug', 'token'),
    ).resolves.toMatchObject({ viewer: { isOwner: false } });
    expect(prisma.shareLink.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      { provider: 'password' },
      'Sign in with the Google account that received this invitation',
    ],
    [
      { emailVerified: false },
      'Sign in with the Google account that received this invitation',
    ],
    [
      { email: 'other@example.com' },
      'Sign in with the Google account that received this invitation',
    ],
    [{ tokenHash: null }, 'Invalid invitation token'],
  ])(
    'rejects invitation acceptance for invalid identity or link (%o)',
    async (identity, message) => {
      prisma.shareLink.findUnique.mockResolvedValue(activeShare(identity));
      await expect(
        service.acceptInvitation(
          { ...reader, ...identity },
          'share-slug',
          'token',
        ),
      ).rejects.toThrow(message);
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    },
  );

  it('rejects access to revoked, expired, and unavailable shared versions', async () => {
    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ isActive: false }),
    );
    await expect(
      service.getSharedManuscript(reader, 'share-slug', 'token'),
    ).rejects.toThrow(
      new GoneException('Share invitation is no longer active'),
    );

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
    );
    await expect(
      service.getSharedManuscript(reader, 'share-slug', 'token'),
    ).rejects.toThrow(new GoneException('Share invitation has expired'));

    prisma.shareLink.findUnique.mockResolvedValueOnce(
      activeShare({ version: null }),
    );
    await expect(
      service.getSharedManuscript(reader, 'share-slug', 'token'),
    ).rejects.toThrow(new GoneException('Shared version is not available'));
  });

  function bookRecord(
    scenes: Array<{
      id: string;
      title: string;
      content: unknown;
      wordCount: number;
    }> = [{ id: sceneId, title: 'Scene one', content: {}, wordCount: 12 }],
  ): Record<string, unknown> {
    return {
      id: 'book-id',
      title: 'Frozen book',
      project: { id: snapshot.projectId, title: 'Project' },
      chapters: [{ id: 'chapter-id', title: 'Chapter', scenes }],
    };
  }

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
});
