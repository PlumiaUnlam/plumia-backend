// The test double mirrors Prisma's dynamically-shaped transaction client.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { type ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { PublishingService } from '../../../src/publishing/publishing.service';
import type { ImageGenerationEventsService } from '../../../src/publishing/workers/image-generation-events.service';
import type { ImageAssetsService } from '../../../src/publishing/image-assets.service';

interface PublishingPrismaMock {
  entity: { findFirst: jest.Mock };
  generatedImage: { findFirst: jest.Mock };
  imageGenerationJob: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
  };
  tx: {
    imageGenerationJob: { create: jest.Mock; update: jest.Mock };
    generatedImage: { create: jest.Mock };
    outbox: { create: jest.Mock };
  };
  $transaction: jest.Mock;
}

interface PublishingStorageMock {
  getPublicUrl: jest.Mock;
  generatePresignedGetUrl: jest.Mock;
  generatePresignedUploadUrl: jest.Mock;
}

interface ImageAssetsMock {
  listImages: jest.Mock;
  listPrimaryImages: jest.Mock;
  setPrimaryImage: jest.Mock;
  deleteImage: jest.Mock;
  generatePreviewImage: jest.Mock;
  attachImage: jest.Mock;
}

describe('PublishingService', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  let service: PublishingService;
  let prisma: PublishingPrismaMock;
  let storage: PublishingStorageMock;
  let imageGeneration: { generate: jest.Mock };
  let imageEvents: { publish: jest.Mock<void, [{ status: string }]> };
  let imageAssets: ImageAssetsMock;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    imageGeneration = { generate: jest.fn() };
    imageEvents = { publish: jest.fn<void, [{ status: string }]>() };
    storage = {
      getPublicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
      generatePresignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://cdn.example/signed'),
      generatePresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ presignedUrl: 'https://upload.example/signed' }),
    };
    imageAssets = {
      listImages: jest.fn(),
      listPrimaryImages: jest.fn(),
      setPrimaryImage: jest.fn(),
      deleteImage: jest.fn(),
      generatePreviewImage: jest.fn(),
      attachImage: jest.fn(),
    };
    const tx = {
      imageGenerationJob: { create: jest.fn(), update: jest.fn() },
      generatedImage: { create: jest.fn() },
      outbox: { create: jest.fn() },
    };
    prisma = {
      entity: { findFirst: jest.fn() },
      generatedImage: { findFirst: jest.fn() },
      imageGenerationJob: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(
        async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(tx),
      ),
      tx,
    };
    const config = {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };
    service = new PublishingService(
      imageGeneration,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      config as unknown as ConfigService,
      imageEvents as unknown as ImageGenerationEventsService,
      imageAssets as unknown as ImageAssetsService,
    );
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      canonicalName: 'Mara',
      description: 'A cartographer',
      type: 'CHARACTER',
      imageUrl: 'https://old.example/mara.png',
      attributes: { hair: 'black' },
    });
    prisma.generatedImage.findFirst.mockResolvedValue(null);
  });

  afterEach(() => fetchMock.mockRestore());

  it('queues image generation with filtered instructions and a reference fallback', async () => {
    const created = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    prisma.tx.imageGenerationJob.create.mockResolvedValue(created);
    const result = await service.requestImageGeneration('user-1', {
      entityId: 'entity-1',
      prompt: 'at the harbor',
      expression: ' curious ',
      pose: ' ',
      background: 'harbor',
      width: 768,
    });

    expect(result).toEqual({
      id: 'job-1',
      entityId: 'entity-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      generatedImage: null,
    });
    expect(prisma.generatedImage.findFirst).toHaveBeenCalledWith({
      where: { entityId: 'entity-1', isPrimary: true },
      select: { id: true, storageKey: true },
    });
    const createData =
      prisma.tx.imageGenerationJob.create.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({
      entityId: 'entity-1',
      userId: 'user-1',
      width: 768,
      height: 512,
      instructions: { expression: ' curious ', background: 'harbor' },
      referenceImageId: null,
      referenceImageUrl: 'https://old.example/mara.png',
      prompt: expect.stringContaining('instrucción adicional: at the harbor'),
    });
    expect(createData.id).toEqual(expect.any(String));
    expect(prisma.tx.outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aggregateType: 'ImageGenerationJob',
          eventType: 'image.generation.requested',
        }),
      }),
    );
    expect(imageEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        status: 'QUEUED',
        progress: 0,
      }),
    );
  });

  it('uses an explicitly selected or primary generated reference image', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    prisma.tx.imageGenerationJob.create.mockResolvedValue(job);
    prisma.generatedImage.findFirst.mockResolvedValue({
      id: 'reference-1',
      storageKey: 'entities/entity-1/reference.png',
    });

    await service.requestImageGeneration('user-1', {
      entityId: 'entity-1',
      referenceImageId: 'reference-1',
    });
    expect(prisma.generatedImage.findFirst).toHaveBeenCalledWith({
      where: { id: 'reference-1', entityId: 'entity-1' },
      select: { id: true, storageKey: true },
    });
    expect(storage.getPublicUrl).toHaveBeenCalledWith(
      'entities/entity-1/reference.png',
    );

    prisma.generatedImage.findFirst.mockResolvedValue(null);
    await service.requestImageGeneration('user-1', {
      entityId: 'entity-1',
    });
    expect(
      prisma.tx.imageGenerationJob.create.mock.calls[1]?.[0].data
        .referenceImageUrl,
    ).toBe('https://old.example/mara.png');
  });

  it('supports a first image without a reference and a one-time visual identity override', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    prisma.tx.imageGenerationJob.create.mockResolvedValue(job);

    await service.requestImageGeneration('user-1', {
      entityId: 'entity-1',
      skipReferenceImage: true,
      visualIdentity: 'Sombrero ancho y una brújula de cobre.',
    });

    const createData =
      prisma.tx.imageGenerationJob.create.mock.calls[0]?.[0].data;
    expect(prisma.generatedImage.findFirst).not.toHaveBeenCalled();
    expect(createData).toMatchObject({
      referenceImageId: null,
      referenceImageUrl: null,
      prompt: expect.stringContaining(
        'Identidad visual prioritaria: Sombrero ancho y una brújula de cobre.',
      ),
    });
    expect(createData.prompt).toContain('Crear la imagen base de la entidad');
  });

  it('rejects image generation when the entity or selected reference is not available', async () => {
    prisma.entity.findFirst.mockResolvedValue(null);
    await expect(
      service.requestImageGeneration('user-1', {
        entityId: 'missing',
      }),
    ).rejects.toThrow(new NotFoundException('Entity not found'));
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-1',
      imageUrl: null,
      canonicalName: 'Mara',
      description: null,
      type: 'CHARACTER',
      attributes: {},
    });
    prisma.generatedImage.findFirst.mockResolvedValue(null);
    await expect(
      service.requestImageGeneration('user-1', {
        entityId: 'entity-1',
        referenceImageId: 'missing',
      }),
    ).rejects.toThrow(new NotFoundException('Reference image not found'));
  });

  it('loads generation job status and signs generated image URLs', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'COMPLETED',
      progress: 100,
      errorMessage: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
      generatedImage: {
        id: 'image-1',
        entityId: 'entity-1',
        prompt: 'Mara',
        storageKey: 'entities/entity-1/image.png',
        imageType: 'image/png',
        isPrimary: false,
        createdAt: now,
      },
    };
    prisma.imageGenerationJob.findFirst.mockResolvedValue(job);
    await expect(
      service.getImageGenerationJob('user-1', 'job-1'),
    ).resolves.toMatchObject({
      id: 'job-1',
      generatedImage: { id: 'image-1', imageUrl: 'https://cdn.example/signed' },
    });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      'entities/entity-1/image.png',
    );
    prisma.imageGenerationJob.findFirst.mockResolvedValue({
      ...job,
      generatedImage: null,
    });
    await expect(
      service.getImageGenerationJob('user-1', 'job-1'),
    ).resolves.toMatchObject({ generatedImage: null });
    prisma.imageGenerationJob.findFirst.mockResolvedValue(null);
    await expect(
      service.getImageGenerationJob('user-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Image generation job not found'));
  });

  it('ignores absent, completed, already generated, and unclaimed jobs', async () => {
    prisma.imageGenerationJob.findUnique.mockResolvedValue(null);
    await expect(
      service.processImageGeneration('missing'),
    ).resolves.toBeUndefined();
    prisma.imageGenerationJob.findUnique.mockResolvedValue({
      generatedImageId: 'image-1',
      status: 'PROCESSING',
    });
    await service.processImageGeneration('job-1');
    prisma.imageGenerationJob.findUnique.mockResolvedValue({
      generatedImageId: null,
      status: 'COMPLETED',
    });
    await service.processImageGeneration('job-1');
    expect(prisma.imageGenerationJob.updateMany).not.toHaveBeenCalled();

    prisma.imageGenerationJob.findUnique.mockResolvedValue({
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      generatedImageId: null,
      startedAt: null,
    });
    prisma.imageGenerationJob.updateMany.mockResolvedValue({ count: 0 });
    await service.processImageGeneration('job-1');
    expect(imageGeneration.generate).not.toHaveBeenCalled();
  });

  it('generates, uploads, persists, and publishes the completed image lifecycle', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      generatedImageId: null,
      startedAt: null,
      prompt: 'Mara by the sea',
      width: 512,
      height: 640,
      seed: 42,
      referenceImageUrl: 'https://ref.example/mara.png',
    };
    prisma.imageGenerationJob.findUnique.mockResolvedValue(job);
    prisma.imageGenerationJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.imageGenerationJob.update.mockResolvedValue({});
    imageGeneration.generate.mockResolvedValue({
      buffer: Buffer.from([1, 2]),
      contentType: 'image/png',
    });
    prisma.tx.generatedImage.create.mockResolvedValue({ id: 'image-1' });
    prisma.tx.imageGenerationJob.update.mockResolvedValue({});

    await expect(
      service.processImageGeneration('job-1'),
    ).resolves.toBeUndefined();
    expect(imageGeneration.generate).toHaveBeenCalledWith({
      prompt: 'Mara by the sea',
      width: 512,
      height: 640,
      seed: 42,
      referenceImageUrl: 'https://ref.example/mara.png',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example/signed',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(prisma.imageGenerationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING', progress: 10 }),
      }),
    );
    expect(prisma.tx.generatedImage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: 'entity-1',
        storageKey: 'entities/entity-1/generated/job-1.png',
        imageType: 'image/png',
      }),
    });
    expect(prisma.tx.imageGenerationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        progress: 100,
        generatedImageId: 'image-1',
      }),
    });
    expect(
      imageEvents.publish.mock.calls.map(([event]) => event.status),
    ).toEqual(['PROCESSING', 'PROCESSING', 'PROCESSING', 'COMPLETED']);
  });

  it('records generation failures and translates image upload failures to a user-safe error', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      userId: 'user-1',
      status: 'QUEUED',
      generatedImageId: null,
      startedAt: now,
      prompt: 'Mara',
      width: 512,
      height: 512,
      seed: 2,
      referenceImageUrl: null,
    };
    prisma.imageGenerationJob.findUnique.mockResolvedValue(job);
    prisma.imageGenerationJob.updateMany.mockResolvedValue({ count: 1 });
    imageGeneration.generate.mockRejectedValue(new Error('provider offline'));
    await expect(service.processImageGeneration('job-1')).rejects.toThrow(
      'provider offline',
    );
    expect(prisma.imageGenerationJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'provider offline',
      }),
    });
    expect(imageEvents.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'provider offline',
      }),
    );

    imageGeneration.generate.mockResolvedValue({
      buffer: Buffer.from([1]),
      contentType: 'image/png',
    });
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(service.processImageGeneration('job-1')).rejects.toThrow(
      'Failed to upload image to storage: 503',
    );
    expect(imageEvents.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'FAILED', progress: 100 }),
    );
  });

  it('delegates image library operations to the image assets service', async () => {
    imageAssets.listImages.mockResolvedValue([]);
    imageAssets.listPrimaryImages.mockResolvedValue([]);
    imageAssets.setPrimaryImage.mockResolvedValue({ id: 'image-1' });
    imageAssets.deleteImage.mockResolvedValue(undefined);
    imageAssets.generatePreviewImage.mockResolvedValue({ imageUrl: 'url' });
    imageAssets.attachImage.mockResolvedValue({ id: 'image-1' });

    await expect(service.listImages('user-1', 'entity-1')).resolves.toEqual([]);
    await expect(
      service.listPrimaryImages('user-1', ['entity-1']),
    ).resolves.toEqual([]);
    await expect(
      service.setPrimaryImage('user-1', 'entity-1', 'image-1'),
    ).resolves.toEqual({ id: 'image-1' });
    await expect(
      service.deleteImage('user-1', 'entity-1', 'image-1'),
    ).resolves.toBeUndefined();
    await expect(service.generatePreviewImage({} as never)).resolves.toEqual({
      imageUrl: 'url',
    });
    await expect(service.attachImage('user-1', {} as never)).resolves.toEqual({
      id: 'image-1',
    });
    expect(imageAssets.listImages).toHaveBeenCalledWith('user-1', 'entity-1');
    expect(imageAssets.listPrimaryImages).toHaveBeenCalledWith('user-1', [
      'entity-1',
    ]);
    expect(imageAssets.setPrimaryImage).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
      'image-1',
    );
    expect(imageAssets.deleteImage).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
      'image-1',
    );
  });
});
