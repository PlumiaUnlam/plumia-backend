import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthService } from '../../../src/auth/auth.service';
import type { FirebaseAdminService } from '../../../src/auth/firebase-admin.service';
import { ReadingController } from '../../../src/reading/reading.controller';
import type { ReadingService } from '../../../src/reading/reading.service';

describe('ReadingController', () => {
  const request = {
    user: { id: 'owner-1', email: 'owner@example.com' },
  };
  const guestRequest = (authorization?: string): Request =>
    ({ headers: { authorization } }) as Request;
  let reading: {
    createShare: jest.Mock;
    listBookShares: jest.Mock;
    updateShare: jest.Mock;
    revokeShare: jest.Mock;
    acceptInvitation: jest.Mock;
    getSharedManuscript: jest.Mock;
    listComments: jest.Mock;
    createComment: jest.Mock;
    replyToComment: jest.Mock;
    updateComment: jest.Mock;
    getSharedStorageUrl: jest.Mock;
  };
  let firebase: { verifyToken: jest.Mock };
  let auth: { resolveExistingUserId: jest.Mock };
  let controller: ReadingController;

  beforeEach(() => {
    reading = {
      createShare: jest.fn().mockResolvedValue({ id: 'share-1' }),
      listBookShares: jest.fn().mockResolvedValue([]),
      updateShare: jest.fn().mockResolvedValue({ id: 'share-1' }),
      revokeShare: jest.fn().mockResolvedValue(undefined),
      acceptInvitation: jest.fn().mockResolvedValue({ viewer: {} }),
      getSharedManuscript: jest.fn().mockResolvedValue({ manuscript: {} }),
      listComments: jest.fn().mockResolvedValue([]),
      createComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
      replyToComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
      updateComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
      getSharedStorageUrl: jest.fn().mockResolvedValue('https://storage.test'),
    };
    firebase = {
      verifyToken: jest.fn().mockResolvedValue({
        uid: 'firebase-user-1',
        email: 'reader@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      }),
    };
    auth = { resolveExistingUserId: jest.fn().mockResolvedValue('reader-1') };
    controller = new ReadingController(
      reading as unknown as ReadingService,
      firebase as unknown as FirebaseAdminService,
      auth as unknown as AuthService,
    );
  });

  it('routes protected share and comment-management endpoints with the logged-in owner', async () => {
    const createShareDto = { email: 'reader@example.com' } as never;
    const updateShareDto = { permission: 'COMMENT' } as never;
    const updateCommentDto = { status: 'RESOLVED' } as never;

    await expect(
      controller.createShare(request as never, 'book-1', createShareDto),
    ).resolves.toEqual({ id: 'share-1' });
    await expect(
      controller.listShares(request as never, 'book-1'),
    ).resolves.toEqual([]);
    await expect(
      controller.updateShare(
        request as never,
        'book-1',
        'share-1',
        updateShareDto,
      ),
    ).resolves.toEqual({ id: 'share-1' });
    await expect(
      controller.revokeShare(request as never, 'book-1', 'share-1'),
    ).resolves.toBeUndefined();
    await expect(
      controller.updateComment(
        request as never,
        'share-slug',
        'comment-1',
        updateCommentDto,
      ),
    ).resolves.toEqual({ id: 'comment-1' });

    expect(reading.createShare).toHaveBeenCalledWith(
      'owner-1',
      'book-1',
      createShareDto,
    );
    expect(reading.listBookShares).toHaveBeenCalledWith('owner-1', 'book-1');
    expect(reading.updateShare).toHaveBeenCalledWith(
      'owner-1',
      'book-1',
      'share-1',
      updateShareDto,
    );
    expect(reading.revokeShare).toHaveBeenCalledWith(
      'owner-1',
      'book-1',
      'share-1',
    );
    expect(reading.updateComment).toHaveBeenCalledWith(
      request.user,
      'share-slug',
      'comment-1',
      updateCommentDto,
    );
  });

  it('routes invitation, comment, reply, and storage endpoints after resolving Firebase identity', async () => {
    const req = guestRequest('Bearer identity-token');
    const createCommentDto = { body: 'A note' } as never;
    const replyDto = { body: 'A reply' } as never;
    const acceptDto = { token: 'share-token' } as never;
    const storageDto = { storageKey: 'scenes/scene-1/image.png' } as never;

    await expect(
      controller.acceptInvitation(req, 'share-slug', acceptDto),
    ).resolves.toEqual({ viewer: {} });
    await expect(
      controller.getSharedManuscript(req, 'share-slug', 'share-token'),
    ).resolves.toEqual({ manuscript: {} });
    await expect(
      controller.listComments(req, 'share-slug', 'share-token'),
    ).resolves.toEqual([]);
    await expect(
      controller.createComment(
        req,
        'share-slug',
        'share-token',
        createCommentDto,
      ),
    ).resolves.toEqual({ id: 'comment-1' });
    await expect(
      controller.replyToComment(
        req,
        'share-slug',
        'comment-1',
        'share-token',
        replyDto,
      ),
    ).resolves.toEqual({ id: 'comment-1' });
    await expect(
      controller.getSharedStorageUrl(
        req,
        'share-slug',
        'share-token',
        storageDto,
      ),
    ).resolves.toEqual({ url: 'https://storage.test' });

    const expectedIdentity = {
      id: 'reader-1',
      email: 'reader@example.com',
      emailVerified: true,
      provider: 'google.com',
    };
    expect(auth.resolveExistingUserId).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'firebase-user-1' }),
    );
    expect(reading.acceptInvitation).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'share-token',
    );
    expect(reading.getSharedManuscript).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'share-token',
    );
    expect(reading.listComments).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'share-token',
    );
    expect(reading.createComment).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'share-token',
      createCommentDto,
    );
    expect(reading.replyToComment).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'comment-1',
      'share-token',
      replyDto,
    );
    expect(reading.getSharedStorageUrl).toHaveBeenCalledWith(
      expectedIdentity,
      'share-slug',
      'scenes/scene-1/image.png',
      'share-token',
    );
  });

  it.each([
    [undefined, 'Google sign-in is required'],
    ['Basic token', 'Google sign-in is required'],
    ['Bearer', 'Google sign-in is required'],
  ])(
    'rejects missing or malformed bearer authorization (%s)',
    async (header, message) => {
      await expect(
        controller.getSharedManuscript(guestRequest(header), 'share-slug'),
      ).rejects.toThrow(new UnauthorizedException(message));
      expect(firebase.verifyToken).not.toHaveBeenCalled();
    },
  );

  it('maps Firebase verification failures to an unauthorized response', async () => {
    firebase.verifyToken.mockRejectedValue(
      new Error('private Firebase detail'),
    );

    await expect(
      controller.listComments(guestRequest('Bearer bad-token'), 'share-slug'),
    ).rejects.toThrow(
      new UnauthorizedException('Invalid or expired identity token'),
    );
    expect(auth.resolveExistingUserId).not.toHaveBeenCalled();
  });

  it('requires an email claim in the verified Firebase identity', async () => {
    firebase.verifyToken.mockResolvedValue({
      uid: 'firebase-user-1',
      firebase: { sign_in_provider: 'google.com' },
    });

    await expect(
      controller.getSharedManuscript(
        guestRequest('Bearer identity-token'),
        'share-slug',
      ),
    ).rejects.toThrow(
      new UnauthorizedException('An email address is required'),
    );
    expect(auth.resolveExistingUserId).not.toHaveBeenCalled();
  });
});
