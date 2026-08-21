import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IMAGE_GENERATION } from './ports/image-generation.port';
import type {
  ImageGeneration,
  ImageGenerationResult,
} from './ports/image-generation.port';
import type { GenerateImageDto } from './dto/generate-image.dto';
import type { ImageResponseDto } from './dto/image-response.dto';
import type { GeneratePreviewImageDto } from './dto/generate-preview-image.dto';
import type { PreviewImageResponseDto } from './dto/preview-image-response.dto';
import type { AttachImageDto } from './dto/attach-image.dto';
import type { ImageGenerationJobRecord } from './dto/image-generation-job-response.dto';
import {
  MIME_EXTENSIONS,
  UPLOAD_TIMEOUT_MS,
  buildSpanishPrompt,
  createImageSeed,
  fetchWithTimeout,
  toUserFriendlyError,
} from './image-publishing.utils';
import { ImageGenerationEventsService } from './workers/image-generation-events.service';
import { ImageAssetsService } from './image-assets.service';

@Injectable()
export class PublishingService {
  constructor(
    @Inject(IMAGE_GENERATION)
    private readonly imageGen: ImageGeneration,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly imageEvents: ImageGenerationEventsService,
    private readonly imageAssets: ImageAssetsService,
  ) {}

  async requestImageGeneration(
    userId: string,
    dto: GenerateImageDto,
  ): Promise<ImageGenerationJobRecord> {
    const entity = await this.findEntityForUser(userId, dto.entityId);
    const reference = await this.resolveReferenceImage(
      entity,
      dto.referenceImageId,
    );
    const instructions = this.toInstructions(dto);
    const prompt = buildSpanishPrompt(entity, instructions, dto.prompt);
    const jobId = randomUUID();
    const width =
      dto.width ?? Number(this.config.get<string>('IMAGE_WIDTH', '512'));
    const height =
      dto.height ?? Number(this.config.get<string>('IMAGE_HEIGHT', '512'));
    const seed = createImageSeed();

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.imageGenerationJob.create({
        data: {
          id: jobId,
          entityId: entity.id,
          userId,
          prompt,
          instructions,
          referenceImageId: reference.id,
          referenceImageUrl: reference.url,
          width,
          height,
          seed,
          bullJobId: jobId,
        },
      });

      await tx.outbox.create({
        data: {
          aggregateType: 'ImageGenerationJob',
          aggregateId: created.id,
          eventType: 'image.generation.requested',
          payload: { imageGenerationJobId: created.id, userId },
          createdAt: new Date(),
        },
      });

      return created;
    });

    this.imageEvents.publish({
      jobId: job.id,
      entityId: job.entityId,
      userId: job.userId,
      status: 'QUEUED',
      progress: job.progress,
    });

    return this.toJobRecord(job, null);
  }

  async getImageGenerationJob(
    userId: string,
    jobId: string,
  ): Promise<ImageGenerationJobRecord> {
    const job = await this.prisma.imageGenerationJob.findFirst({
      where: {
        id: jobId,
        userId,
        entity: { deletedAt: null, project: { userId, deletedAt: null } },
      },
      include: { generatedImage: true },
    });

    if (!job) {
      throw new NotFoundException('Image generation job not found');
    }

    const generatedImage = job.generatedImage
      ? this.toResponse(
          job.generatedImage,
          await this.storage.generatePresignedGetUrl(
            job.generatedImage.storageKey,
          ),
        )
      : null;

    return this.toJobRecord(job, generatedImage);
  }

  async processImageGeneration(jobId: string): Promise<void> {
    const job = await this.prisma.imageGenerationJob.findUnique({
      where: { id: jobId },
    });

    if (!job || job.generatedImageId || job.status === 'COMPLETED') {
      return;
    }

    const claimed = await this.prisma.imageGenerationJob.updateMany({
      where: {
        id: jobId,
        status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
        generatedImageId: null,
      },
      data: {
        status: 'PROCESSING',
        progress: 10,
        startedAt: job.startedAt ?? new Date(),
        errorMessage: null,
      },
    });

    if (claimed.count === 0) {
      return;
    }

    this.imageEvents.publish({
      jobId: job.id,
      entityId: job.entityId,
      userId: job.userId,
      status: 'PROCESSING',
      progress: 10,
    });

    try {
      const result = await this.imageGen.generate({
        prompt: job.prompt,
        width: job.width,
        height: job.height,
        seed: job.seed,
        ...(job.referenceImageUrl
          ? { referenceImageUrl: job.referenceImageUrl }
          : {}),
      });
      await this.prisma.imageGenerationJob.update({
        where: { id: jobId },
        data: { progress: 45 },
      });
      this.imageEvents.publish({
        jobId: job.id,
        entityId: job.entityId,
        userId: job.userId,
        status: 'PROCESSING',
        progress: 45,
      });

      const ext = MIME_EXTENSIONS[result.contentType] ?? 'jpg';
      const storageKey = `entities/${job.entityId}/generated/${job.id}.${ext}`;
      await this.uploadImage(job.entityId, storageKey, result);
      await this.prisma.imageGenerationJob.update({
        where: { id: jobId },
        data: { progress: 80 },
      });
      this.imageEvents.publish({
        jobId: job.id,
        entityId: job.entityId,
        userId: job.userId,
        status: 'PROCESSING',
        progress: 80,
      });

      await this.prisma.$transaction(async (tx) => {
        const image = await tx.generatedImage.create({
          data: {
            entityId: job.entityId,
            prompt: job.prompt,
            storageKey,
            imageType: result.contentType,
            isPrimary: false,
          },
        });

        await tx.imageGenerationJob.update({
          where: { id: jobId },
          data: {
            generatedImageId: image.id,
            status: 'COMPLETED',
            progress: 100,
            completedAt: new Date(),
          },
        });
      });
      this.imageEvents.publish({
        jobId: job.id,
        entityId: job.entityId,
        userId: job.userId,
        status: 'COMPLETED',
        progress: 100,
      });
    } catch (error: unknown) {
      await this.prisma.imageGenerationJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          progress: 100,
          errorMessage:
            error instanceof Error ? error.message : 'Image generation failed',
        },
      });
      this.imageEvents.publish({
        jobId: job.id,
        entityId: job.entityId,
        userId: job.userId,
        status: 'FAILED',
        progress: 100,
        errorMessage:
          error instanceof Error ? error.message : 'Image generation failed',
      });
      throw error;
    }
  }

  private async findEntityForUser(
    userId: string,
    entityId: string,
  ): Promise<{
    id: string;
    canonicalName: string;
    description: string | null;
    type: string;
    imageUrl: string | null;
    attributes: unknown;
  }> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: {
        id: true,
        canonicalName: true,
        description: true,
        type: true,
        imageUrl: true,
        attributes: true,
      },
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }
    return entity;
  }

  private async resolveReferenceImage(
    entity: { id: string; imageUrl: string | null },
    referenceImageId?: string,
  ): Promise<{ id: string | null; url: string | null }> {
    if (referenceImageId) {
      const image = await this.prisma.generatedImage.findFirst({
        where: { id: referenceImageId, entityId: entity.id },
        select: { id: true, storageKey: true },
      });
      if (!image) {
        throw new NotFoundException('Reference image not found');
      }
      return {
        id: image.id,
        url: this.storage.getPublicUrl(image.storageKey),
      };
    }

    const primary = await this.prisma.generatedImage.findFirst({
      where: { entityId: entity.id, isPrimary: true },
      select: { id: true, storageKey: true },
    });
    if (primary) {
      return {
        id: primary.id,
        url: this.storage.getPublicUrl(primary.storageKey),
      };
    }

    return { id: null, url: entity.imageUrl };
  }

  private toInstructions(dto: GenerateImageDto): Record<string, string> {
    const values = {
      expression: dto.expression,
      pose: dto.pose,
      background: dto.background,
      framing: dto.framing,
      lighting: dto.lighting,
      style: dto.style,
      additionalInstructions: dto.additionalInstructions,
    };
    return Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0,
      ),
    );
  }

  private async uploadImage(
    entityId: string,
    storageKey: string,
    result: ImageGenerationResult,
  ): Promise<void> {
    let presignedUrl: string;
    try {
      const urls = await this.storage.generatePresignedUploadUrl(
        entityId,
        storageKey,
        result.contentType,
        storageKey,
      );
      presignedUrl = urls.presignedUrl;
    } catch (err) {
      toUserFriendlyError(err);
    }

    const uploadResponse = await fetchWithTimeout(presignedUrl, {
      method: 'PUT',
      body: new Uint8Array(result.buffer),
      headers: { 'Content-Type': result.contentType },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload image to storage: ${uploadResponse.status}`,
      );
    }
  }

  async listImages(
    userId: string,
    entityId: string,
  ): Promise<ImageResponseDto[]> {
    return this.imageAssets.listImages(userId, entityId);
  }

  async listPrimaryImages(
    userId: string,
    entityIds: readonly string[],
  ): Promise<ImageResponseDto[]> {
    return this.imageAssets.listPrimaryImages(userId, entityIds);
  }

  async setPrimaryImage(
    userId: string,
    entityId: string,
    imageId: string,
  ): Promise<ImageResponseDto> {
    return this.imageAssets.setPrimaryImage(userId, entityId, imageId);
  }

  async deleteImage(
    userId: string,
    entityId: string,
    imageId: string,
  ): Promise<void> {
    return this.imageAssets.deleteImage(userId, entityId, imageId);
  }

  async generatePreviewImage(
    dto: GeneratePreviewImageDto,
  ): Promise<PreviewImageResponseDto> {
    return this.imageAssets.generatePreviewImage(dto);
  }

  async attachImage(
    userId: string,
    dto: AttachImageDto,
  ): Promise<ImageResponseDto> {
    return this.imageAssets.attachImage(userId, dto);
  }

  private toJobRecord(
    job: {
      id: string;
      entityId: string;
      status: ImageGenerationJobRecord['status'];
      progress: number;
      errorMessage: string | null;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
    },
    generatedImage: ImageResponseDto | null,
  ): ImageGenerationJobRecord {
    return {
      id: job.id,
      entityId: job.entityId,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      generatedImage,
    };
  }

  private toResponse(
    image: {
      id: string;
      entityId: string;
      prompt: string;
      storageKey: string;
      imageType: string;
      isPrimary: boolean;
      createdAt: Date;
    },
    imageUrl: string,
  ): ImageResponseDto {
    return {
      id: image.id,
      entityId: image.entityId,
      prompt: image.prompt,
      imageUrl,
      imageType: image.imageType,
      isPrimary: image.isPrimary,
      createdAt: image.createdAt,
    };
  }
}
