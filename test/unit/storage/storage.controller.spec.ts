import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { StorageController } from '../../../src/storage/storage.controller';
import type { AuthenticatedRequest } from '../../../src/storage/authenticated-request';

describe('StorageController', () => {
  let controller: StorageController;
  let storage: {
    extractKeyFromUrl: jest.Mock;
    generatePresignedUploadUrl: jest.Mock;
    generatePresignedGetUrl: jest.Mock;
  };
  let prisma: {
    entity: { findFirst: jest.Mock; findUnique: jest.Mock };
    scene: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let firebase: { verifyToken: jest.Mock };
  let authorization: { hasStoryboardCardAccess: jest.Mock };
  const req = (headers: Record<string, string> = {}): AuthenticatedRequest =>
    ({ user: { id: 'user-1' }, headers }) as AuthenticatedRequest;

  beforeEach(() => {
    storage = {
      extractKeyFromUrl: jest
        .fn()
        .mockReturnValue('entities/entity-1/image.png'),
      generatePresignedUploadUrl: jest.fn().mockResolvedValue({
        presignedUrl: 'https://upload.example/signed',
        publicUrl: 'https://cdn.example/image',
        storageKey: 'entities/entity-1/image.png',
      }),
      generatePresignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://download.example/signed'),
    };
    prisma = {
      entity: { findFirst: jest.fn(), findUnique: jest.fn() },
      scene: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    firebase = { verifyToken: jest.fn().mockResolvedValue({ uid: 'user-1' }) };
    authorization = {
      hasStoryboardCardAccess: jest.fn().mockResolvedValue(true),
    };
    controller = new StorageController(
      storage as never,
      prisma as never,
      firebase as never,
      authorization,
    );
  });

  it('generates uploads for supported resources and handles replacement keys', async () => {
    const dto = {
      entityId: 'entity-1',
      filename: 'cover.png',
      contentType: 'image/png',
      existingImageUrl: 'https://cdn.example/bucket/entities/entity-1/old.png',
    };
    await expect(
      controller.presignedUpload(req(), dto as never),
    ).resolves.toEqual({
      presignedUrl: 'https://upload.example/signed',
      publicUrl: 'https://cdn.example/image',
      storageKey: 'entities/entity-1/image.png',
    });
    expect(storage.extractKeyFromUrl).toHaveBeenCalledWith(
      dto.existingImageUrl,
    );
    expect(storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      'entity-1',
      'cover.png',
      'image/png',
      'entities/entity-1/image.png',
      'entities',
    );

    await controller.presignedUpload(req(), {
      ...dto,
      existingImageUrl: undefined,
    } as never);
    expect(storage.generatePresignedUploadUrl).toHaveBeenLastCalledWith(
      'entity-1',
      'cover.png',
      'image/png',
      undefined,
      'entities',
    );
    await controller.presignedUpload(req(), {
      ...dto,
      storageFolder: 'storyboard-audio',
    } as never);
    expect(authorization.hasStoryboardCardAccess).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
    );
    expect(storage.generatePresignedUploadUrl).toHaveBeenLastCalledWith(
      'entity-1',
      'cover.png',
      'image/png',
      'entities/entity-1/image.png',
      'storyboard-audio',
    );

    authorization.hasStoryboardCardAccess.mockResolvedValue(false);
    await expect(
      controller.presignedUpload(req(), {
        ...dto,
        storageFolder: 'storyboard-audio',
      } as never),
    ).rejects.toThrow(new NotFoundException('Storyboard card not found'));
    authorization.hasStoryboardCardAccess.mockResolvedValue(true);
    storage.generatePresignedUploadUrl.mockRejectedValue(new Error('bad mime'));
    await expect(
      controller.presignedUpload(req(), dto as never),
    ).rejects.toThrow(new HttpException('bad mime', 400));
  });

  it('authorizes key-based downloads for entities, scenes, and storyboard cards', async () => {
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      project: { userId: 'user-1' },
    });
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'entities/entity-1/image.png',
      }),
    ).resolves.toEqual({ url: 'https://download.example/signed' });
    expect(prisma.entity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'entity-1', deletedAt: null } }),
    );

    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { project: { userId: 'user-1' } } },
    });
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'scenes/scene-1/version.json',
      }),
    ).resolves.toEqual({ url: 'https://download.example/signed' });
    expect(prisma.scene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'scene-1', deletedAt: null } }),
    );

    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'storyboard-audio/card-1/audio.webm',
      }),
    ).resolves.toEqual({ url: 'https://download.example/signed' });
    expect(authorization.hasStoryboardCardAccess).toHaveBeenCalledWith(
      'user-1',
      'card-1',
    );
    expect(storage.generatePresignedGetUrl).toHaveBeenLastCalledWith(
      'storyboard-audio/card-1/audio.webm',
    );
  });

  it('rejects malformed or inaccessible storage keys', async () => {
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'entities/entity-1',
      }),
    ).rejects.toThrow(new HttpException('Invalid storage key', 400));
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'entities//image.png',
      }),
    ).rejects.toThrow(new HttpException('Invalid storage key', 400));

    prisma.entity.findFirst.mockResolvedValue(null);
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'entities/entity-1/image.png',
      }),
    ).rejects.toThrow(new HttpException('Entity not found', 404));
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      project: { userId: 'someone-else' },
    });
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'entities/entity-1/image.png',
      }),
    ).rejects.toThrow(new HttpException('Forbidden', 403));

    prisma.scene.findFirst.mockResolvedValue(null);
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'scenes/scene-1/file',
      }),
    ).rejects.toThrow(new HttpException('Scene not found', 404));
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { project: { userId: 'someone-else' } } },
    });
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'scenes/scene-1/file',
      }),
    ).rejects.toThrow(new HttpException('Forbidden', 403));
    authorization.hasStoryboardCardAccess.mockResolvedValue(false);
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'storyboard-audio/card-1/audio.webm',
      }),
    ).rejects.toThrow(new NotFoundException('Storyboard card not found'));
  });

  it('generates downloads for an entity image only for its owner', async () => {
    prisma.entity.findUnique.mockResolvedValue({
      imageUrl: 'https://cdn.example/bucket/entities/entity-1/image.png',
      project: { userId: 'user-1' },
    });
    await expect(
      controller.presignedDownload(req(), { entityId: 'entity-1' }),
    ).resolves.toEqual({ url: 'https://download.example/signed' });
    expect(storage.extractKeyFromUrl).toHaveBeenCalledWith(
      'https://cdn.example/bucket/entities/entity-1/image.png',
    );

    prisma.entity.findUnique.mockResolvedValue(null);
    await expect(
      controller.presignedDownload(req(), { entityId: 'missing' }),
    ).rejects.toThrow(new HttpException('Entity not found', 404));
    prisma.entity.findUnique.mockResolvedValue({
      imageUrl: null,
      project: { userId: 'user-1' },
    });
    await expect(
      controller.presignedDownload(req(), { entityId: 'entity-1' }),
    ).rejects.toThrow(new HttpException('Entity has no image', 400));
    prisma.entity.findUnique.mockResolvedValue({
      imageUrl: 'image-url',
      project: { userId: 'someone-else' },
    });
    await expect(
      controller.presignedDownload(req(), { entityId: 'entity-1' }),
    ).rejects.toThrow(new HttpException('Forbidden', 403));
  });

  it('serves authenticated image redirects using a bearer token or session cookie', async () => {
    const response = { setHeader: jest.fn(), redirect: jest.fn() };
    const entity = {
      imageUrl: 'https://cdn.example/bucket/entities/entity-1/image.png',
      project: { userId: 'user-1' },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.entity.findUnique.mockResolvedValue(entity);

    await expect(
      controller.getImage(
        'entity-1',
        req({ authorization: 'Bearer token-1' }),
        response as never,
      ),
    ).resolves.toBeUndefined();
    expect(firebase.verifyToken).toHaveBeenCalledWith('token-1');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-cache, no-store, must-revalidate',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://download.example/signed',
    );

    await controller.getImage(
      'entity-1',
      req({ cookie: 'other=x; __session=cookie-token' }),
      response as never,
    );
    expect(firebase.verifyToken).toHaveBeenLastCalledWith('cookie-token');

    await expect(
      controller.getImage('entity-1', req(), response as never),
    ).rejects.toThrow(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      controller.getImage(
        'entity-1',
        req({ authorization: 'Bearer token-1' }),
        response as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns specific image errors before redirecting', async () => {
    const response = { setHeader: jest.fn(), redirect: jest.fn() };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.entity.findUnique.mockResolvedValue(null);
    await expect(
      controller.getImage(
        'missing',
        req({ authorization: 'Bearer token' }),
        response as never,
      ),
    ).rejects.toThrow(new NotFoundException('Entity not found'));
    prisma.entity.findUnique.mockResolvedValue({
      imageUrl: null,
      project: { userId: 'user-1' },
    });
    await expect(
      controller.getImage(
        'entity-1',
        req({ authorization: 'Bearer token' }),
        response as never,
      ),
    ).rejects.toThrow(new BadRequestException('Entity has no image'));
    prisma.entity.findUnique.mockResolvedValue({
      imageUrl: 'url',
      project: { userId: 'other-user' },
    });
    await expect(
      controller.getImage(
        'entity-1',
        req({ authorization: 'Bearer token' }),
        response as never,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it('serves only the authenticated user’s profile image from their profile folder', async () => {
    const response = { setHeader: jest.fn(), redirect: jest.fn() };
    prisma.user.findUnique.mockResolvedValue({
      avatarUrl: 'https://cdn.example/bucket/profiles/user-1/avatar.png',
    });
    storage.extractKeyFromUrl.mockReturnValue('profiles/user-1/avatar.png');

    await expect(
      controller.getProfileImage('user-1', req(), response as never),
    ).resolves.toBeUndefined();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { avatarUrl: true },
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-cache',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://download.example/signed',
    );

    await expect(
      controller.getProfileImage('someone-else', req(), response as never),
    ).rejects.toThrow(ForbiddenException);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      controller.getProfileImage('user-1', req(), response as never),
    ).rejects.toThrow(new NotFoundException('Profile image not found'));

    prisma.user.findUnique.mockResolvedValueOnce({
      avatarUrl: 'https://cdn.example/bucket/entities/entity-1/avatar.png',
    });
    storage.extractKeyFromUrl.mockReturnValueOnce(
      'entities/entity-1/avatar.png',
    );
    await expect(
      controller.getProfileImage('user-1', req(), response as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('restricts profile upload ownership and profile download keys', async () => {
    await expect(
      controller.presignedUpload(req(), {
        entityId: 'someone-else',
        filename: 'avatar.png',
        contentType: 'image/png',
        storageFolder: 'profiles',
      } as never),
    ).rejects.toThrow(ForbiddenException);
    storage.generatePresignedUploadUrl.mockResolvedValueOnce({
      presignedUrl: 'https://upload.example/profile',
      publicUrl: 'https://cdn.example/profile',
      storageKey: 'profiles/user-1/avatar.png',
    });
    await expect(
      controller.presignedUpload(req(), {
        entityId: 'user-1',
        filename: 'avatar.png',
        contentType: 'image/png',
        storageFolder: 'profiles',
      } as never),
    ).resolves.toMatchObject({ storageKey: 'profiles/user-1/avatar.png' });
    expect(storage.generatePresignedUploadUrl).toHaveBeenLastCalledWith(
      'user-1',
      'avatar.png',
      'image/png',
      undefined,
      'profiles',
    );

    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'profiles/someone-else/avatar.png',
      }),
    ).rejects.toThrow(new HttpException('Forbidden', 403));
    await expect(
      controller.presignedDownloadByKey(req(), {
        storageKey: 'profiles/user-1/avatar.png',
      }),
    ).resolves.toEqual({ url: 'https://download.example/signed' });
  });
});
