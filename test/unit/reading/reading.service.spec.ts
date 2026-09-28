import { ForbiddenException } from '@nestjs/common';
import { SharePermission, ShareStatus } from '@prisma/client';
import { ReadingService } from '../../../src/reading/reading.service';

describe('ReadingService', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const snapshot = {
    schemaVersion: 1,
    projectId: '10000000-0000-4000-8000-000000000001',
    title: 'Frozen book',
    frozenAt: now.toISOString(),
    books: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Frozen book',
        chapters: [],
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
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { generatePresignedGetUrl: jest.fn() };
  const service = new ReadingService(prisma as never, storage as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  it('freezes the ordered manuscript before creating an email invitation', async () => {
    prisma.book.findFirst.mockResolvedValue({
      id: snapshot.books[0].id,
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

    const result = await service.createShare('owner-id', snapshot.books[0].id, {
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
    expect(shareInput.data.bookId).toBe(snapshot.books[0].id);
    expect(shareInput.data.permission).toBe(SharePermission.COMMENT);
    expect(shareInput.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not accept an invitation from a different email', async () => {
    prisma.shareLink.findUnique.mockResolvedValue(
      activeShare({ permission: SharePermission.COMMENT }),
    );

    await expect(
      service.acceptInvitation(
        { id: 'reader-id', email: 'other@example.com' },
        'share-slug',
        'token',
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'This invitation belongs to a different email address',
      ),
    );
    expect(prisma.shareLink.update).not.toHaveBeenCalled();
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
      service.createComment(
        { id: 'reader-id', email: 'reader@example.com' },
        'share-slug',
        {
          snapshotSceneId: '40000000-0000-4000-8000-000000000001',
          anchorFrom: 1,
          anchorTo: 4,
          selectedText: 'The',
          body: 'Comment',
        },
      ),
    ).rejects.toThrow(new ForbiddenException('This invitation is read-only'));
    expect(prisma.readerComment.create).not.toHaveBeenCalled();

    await expect(
      service.createComment(
        { id: 'owner-id', email: 'owner@example.com' },
        'share-slug',
        {
          snapshotSceneId: '40000000-0000-4000-8000-000000000001',
          anchorFrom: 1,
          anchorTo: 4,
          selectedText: 'The',
          body: 'Owner comment',
        },
      ),
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
      tokenHash: '0'.repeat(64),
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
