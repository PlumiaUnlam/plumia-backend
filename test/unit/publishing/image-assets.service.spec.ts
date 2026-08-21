import { ImageAssetsService } from '../../../src/publishing/image-assets.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import type { ImageGeneration } from '../../../src/publishing/ports/image-generation.port';
import type { ConfigService } from '@nestjs/config';

describe('ImageAssetsService', () => {
  const entityId = 'entity-1';
  const imageId = 'image-1';

  function createService(): {
    prisma: {
      entity: { findFirst: jest.Mock };
      generatedImage: { findFirst: jest.Mock };
      $transaction: jest.Mock;
    };
    storage: {
      deleteObject: jest.Mock;
      getPublicUrl: jest.Mock;
    };
    service: ImageAssetsService;
  } {
    const prisma = {
      entity: { findFirst: jest.fn() },
      generatedImage: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const storage = {
      deleteObject: jest.fn(),
      getPublicUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
    };

    const service = new ImageAssetsService(
      {} as ImageGeneration,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      {} as ConfigService,
    );

    return { prisma, storage, service };
  }

  it('treats deleting an image that is already gone as a successful no-op', async () => {
    const { prisma, storage, service } = createService();
    prisma.entity.findFirst.mockResolvedValue({ id: entityId, imageUrl: null });
    prisma.generatedImage.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: { findFirst: prisma.generatedImage.findFirst },
        }),
    );

    await expect(
      service.deleteImage('user-1', entityId, imageId),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('treats a concurrent Prisma not-found delete as a successful no-op', async () => {
    const { prisma, storage, service } = createService();
    prisma.entity.findFirst.mockResolvedValue({ id: entityId, imageUrl: null });
    prisma.generatedImage.findFirst.mockResolvedValue({
      id: imageId,
      storageKey: `entities/${entityId}/image.png`,
      isPrimary: false,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: {
            findFirst: prisma.generatedImage.findFirst,
            delete: jest.fn().mockRejectedValue({ code: 'P2025' }),
          },
        }),
    );

    await expect(
      service.deleteImage('user-1', entityId, imageId),
    ).resolves.toBeUndefined();

    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
