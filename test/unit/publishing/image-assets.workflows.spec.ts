// The test double mirrors Prisma's dynamically-shaped transaction client.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { type ConfigService } from '@nestjs/config';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { ImageAssetsService } from '../../../src/publishing/image-assets.service';

interface ImageAssetsPrismaMock {
  entity: { findFirst: jest.Mock; update: jest.Mock };
  generatedImage: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findFirstOrThrow: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface ImageAssetsStorageMock {
  generatePresignedGetUrl: jest.Mock;
  generatePresignedUploadUrl: jest.Mock;
  getPublicUrl: jest.Mock;
  deleteObject: jest.Mock;
}

describe('ImageAssetsService workflows', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  let service: ImageAssetsService;
  let prisma: ImageAssetsPrismaMock;
  let storage: ImageAssetsStorageMock;
  let imageGeneration: { generate: jest.Mock };
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    const imageRecord = {
      id: 'image-1',
      entityId: 'entity-1',
      prompt: 'Mara',
      storageKey: 'entities/entity-1/mara.png',
      imageType: 'image/png',
      isPrimary: true,
      createdAt: now,
    };
    const tx = {
      generatedImage: {
        findFirst: jest.fn().mockResolvedValue(imageRecord),
        delete: jest.fn().mockResolvedValue(imageRecord),
        findFirstOrThrow: jest.fn().mockResolvedValue(imageRecord),
        update: jest.fn().mockResolvedValue(imageRecord),
      },
      entity: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      entity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'entity-1', imageUrl: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      generatedImage: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue(imageRecord),
        create: jest.fn().mockResolvedValue(imageRecord),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(imageRecord),
        delete: jest.fn().mockResolvedValue(imageRecord),
      },
      $transaction: jest.fn((input: unknown) =>
        typeof input === 'function'
          ? Promise.resolve(input(tx))
          : Promise.all(input as Promise<unknown>[]),
      ),
    };
    storage = {
      generatePresignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://cdn.example/signed'),
      generatePresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ presignedUrl: 'https://upload.example/signed' }),
      getPublicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    imageGeneration = {
      generate: jest.fn().mockResolvedValue({
        buffer: Buffer.from([1, 2]),
        contentType: 'image/png',
      }),
    };
    const config = {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };
    service = new ImageAssetsService(
      imageGeneration,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      config as unknown as ConfigService,
    );
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
  });

  afterEach(() => fetchMock.mockRestore());

  it('lists owned entity images with signed URLs and handles inaccessible entities', async () => {
    const image = {
      id: 'image-1',
      entityId: 'entity-1',
      prompt: 'Mara',
      storageKey: 'entities/entity-1/mara.png',
      imageType: 'image/png',
      isPrimary: true,
      createdAt: now,
    };
    prisma.generatedImage.findMany.mockResolvedValue([image]);
    await expect(service.listImages('user-1', 'entity-1')).resolves.toEqual([
      {
        id: 'image-1',
        entityId: 'entity-1',
        prompt: 'Mara',
        imageUrl: 'https://cdn.example/signed',
        imageType: 'image/png',
        isPrimary: true,
        createdAt: now,
      },
    ]);
    expect(prisma.entity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'entity-1',
          deletedAt: null,
          project: { userId: 'user-1', deletedAt: null },
        },
      }),
    );
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      'entities/entity-1/mara.png',
    );
    prisma.entity.findFirst.mockResolvedValue(null);
    await expect(
      service.listImages('user-1', 'private-entity'),
    ).rejects.toThrow(new NotFoundException('Entity not found'));
  });

  it('deduplicates primary-image entity ids and avoids a query for an empty request', async () => {
    await expect(service.listPrimaryImages('user-1', [])).resolves.toEqual([]);
    expect(prisma.generatedImage.findMany).not.toHaveBeenCalled();
    prisma.generatedImage.findMany.mockResolvedValue([]);
    await expect(
      service.listPrimaryImages('user-1', ['entity-1', 'entity-1', 'entity-2']),
    ).resolves.toEqual([]);
    expect(prisma.generatedImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: { in: ['entity-1', 'entity-2'] },
          isPrimary: true,
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('sets one primary image and synchronizes the entity image URL', async () => {
    await expect(
      service.setPrimaryImage('user-1', 'entity-1', 'image-1'),
    ).resolves.toMatchObject({
      id: 'image-1',
      imageUrl: 'https://cdn.example/signed',
      isPrimary: true,
    });
    expect(prisma.generatedImage.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 'image-1', entityId: 'entity-1' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
    expect(prisma.generatedImage.updateMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-1', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(prisma.generatedImage.update).toHaveBeenCalledWith({
      where: { id: 'image-1' },
      data: { isPrimary: true },
    });
    expect(prisma.entity.update).toHaveBeenCalledWith({
      where: { id: 'entity-1' },
      data: { imageUrl: 'https://cdn.example/entities/entity-1/mara.png' },
    });
  });

  it('deletes a non-primary image and treats missing rows as no-ops', async () => {
    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'image-1',
              storageKey: 'old.png',
              isPrimary: false,
            }),
            delete: jest.fn().mockResolvedValue({}),
            findFirstOrThrow: jest.fn(),
            update: jest.fn(),
          },
          entity: { update: jest.fn() },
        }),
    );
    await expect(
      service.deleteImage('user-1', 'entity-1', 'image-1'),
    ).resolves.toBeUndefined();
    expect(storage.deleteObject).toHaveBeenCalledWith('old.png');

    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: { findFirst: jest.fn().mockResolvedValue(null) },
          entity: { update: jest.fn() },
        }),
    );
    await expect(
      service.deleteImage('user-1', 'entity-1', 'missing'),
    ).resolves.toBeUndefined();
  });

  it('selects the next primary image after deleting a primary and clears only its own URL', async () => {
    const next = { id: 'image-2', storageKey: 'next.png' };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'image-1',
        storageKey: 'old.png',
        isPrimary: true,
      })
      .mockResolvedValueOnce(next);
    const update = jest.fn();
    const entityUpdate = jest.fn();
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      imageUrl: 'https://cdn.example/old.png',
    });
    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: { findFirst, delete: jest.fn(), update },
          entity: { update: entityUpdate },
        }),
    );

    await service.deleteImage('user-1', 'entity-1', 'image-1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'image-2' },
      data: { isPrimary: true },
    });
    expect(entityUpdate).toHaveBeenCalledWith({
      where: { id: 'entity-1' },
      data: { imageUrl: 'https://cdn.example/next.png' },
    });
    expect(storage.deleteObject).toHaveBeenCalledWith('old.png');

    const noNextFind = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'image-1',
        storageKey: 'old.png',
        isPrimary: true,
      })
      .mockResolvedValueOnce(null);
    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: { findFirst: noNextFind, delete: jest.fn() },
          entity: { update: entityUpdate },
        }),
    );
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      imageUrl: 'https://cdn.example/old.png',
    });
    await service.deleteImage('user-1', 'entity-1', 'image-1');
    expect(entityUpdate).toHaveBeenLastCalledWith({
      where: { id: 'entity-1' },
      data: { imageUrl: null },
    });

    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generatedImage: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'image-1',
                storageKey: 'old.png',
                isPrimary: true,
              })
              .mockResolvedValueOnce(null),
            delete: jest.fn(),
          },
          entity: { update: entityUpdate },
        }),
    );
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      imageUrl: 'https://other.example/custom.png',
    });
    await service.deleteImage('user-1', 'entity-1', 'image-1');
    expect(entityUpdate).toHaveBeenLastCalledWith({
      where: { id: 'entity-1' },
      data: { imageUrl: 'https://other.example/custom.png' },
    });
  });

  it('ignores concurrent database deletes and rethrows other persistence errors', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2025' });
    await expect(
      service.deleteImage('user-1', 'entity-1', 'missing'),
    ).resolves.toBeUndefined();
    prisma.$transaction.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      service.deleteImage('user-1', 'entity-1', 'image-1'),
    ).rejects.toThrow('database unavailable');
  });

  it('generates preview images with default dimensions and maps upload failures safely', async () => {
    const result = await service.generatePreviewImage({
      name: 'La brújula',
      type: 'OBJECT',
      attributes: { material: 'silver' },
    });
    expect(result).toMatchObject({
      imageUrl: 'https://cdn.example/signed',
      imageType: 'image/png',
      prompt: expect.stringContaining('brújula'),
    });
    expect(imageGeneration.generate).toHaveBeenCalledWith({
      prompt: expect.any(String),
      width: 512,
      height: 512,
    });
    expect(storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      'preview',
      expect.stringMatching(/^entities\/preview\/[0-9a-f-]+\.png$/),
      'image/png',
      expect.any(String),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example/signed',
      expect.objectContaining({ method: 'PUT' }),
    );

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(
      service.generatePreviewImage({
        name: 'X',
        type: 'OBJECT',
        width: 768,
        height: 640,
      }),
    ).rejects.toThrow(
      new HttpException(
        'Error al guardar la imagen generada. Intentá de nuevo.',
        502,
      ),
    );
    expect(imageGeneration.generate).toHaveBeenLastCalledWith({
      prompt: expect.any(String),
      width: 768,
      height: 640,
    });
  });

  it('attaches an uploaded image as primary and updates the entity card', async () => {
    const dto = {
      entityId: 'entity-1',
      storageKey: 'entities/entity-1/upload.png',
      prompt: 'Mara',
      imageType: 'image/png',
    };
    await expect(service.attachImage('user-1', dto)).resolves.toMatchObject({
      id: 'image-1',
      imageUrl: 'https://cdn.example/signed',
      isPrimary: true,
    });
    expect(prisma.generatedImage.create).toHaveBeenCalledWith({
      data: {
        entityId: 'entity-1',
        prompt: 'Mara',
        storageKey: dto.storageKey,
        imageType: 'image/png',
        isPrimary: true,
      },
    });
    expect(prisma.generatedImage.updateMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-1', isPrimary: true, id: { not: 'image-1' } },
      data: { isPrimary: false },
    });
    expect(prisma.entity.update).toHaveBeenCalledWith({
      where: { id: 'entity-1' },
      data: { imageUrl: `https://cdn.example/${dto.storageKey}` },
    });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      dto.storageKey,
    );
    prisma.entity.findFirst.mockResolvedValue(null);
    await expect(service.attachImage('user-1', dto)).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
  });
});
