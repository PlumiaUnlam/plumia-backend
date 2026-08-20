import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IMAGE_GENERATION } from './ports/image-generation.port';
import type { ImageGeneration } from './ports/image-generation.port';
import type { AttachImageDto } from './dto/attach-image.dto';
import type { GeneratePreviewImageDto } from './dto/generate-preview-image.dto';
import type { ImageResponseDto } from './dto/image-response.dto';
import type { PreviewImageResponseDto } from './dto/preview-image-response.dto';
import {
  MIME_EXTENSIONS,
  UPLOAD_TIMEOUT_MS,
  buildSpanishPromptFromData,
  fetchWithTimeout,
  toUserFriendlyError,
} from './image-publishing.utils';

@Injectable()
export class ImageAssetsService {
  constructor(
    @Inject(IMAGE_GENERATION)
    private readonly imageGen: ImageGeneration,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async listImages(
    userId: string,
    entityId: string,
  ): Promise<ImageResponseDto[]> {
    const entity = await this.findEntityForUser(userId, entityId);
    const images = await this.prisma.generatedImage.findMany({
      where: { entityId: entity.id },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      images.map(async (image) =>
        this.toResponse(
          image,
          await this.storage.generatePresignedGetUrl(image.storageKey),
        ),
      ),
    );
  }

  async listPrimaryImages(
    userId: string,
    entityIds: readonly string[],
  ): Promise<ImageResponseDto[]> {
    const ids = [...new Set(entityIds)];
    if (ids.length === 0) {
      return [];
    }

    const images = await this.prisma.generatedImage.findMany({
      where: {
        entityId: { in: ids },
        isPrimary: true,
        entity: {
          deletedAt: null,
          project: { userId, deletedAt: null },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      images.map(async (image) =>
        this.toResponse(
          image,
          await this.storage.generatePresignedGetUrl(image.storageKey),
        ),
      ),
    );
  }

  async setPrimaryImage(
    userId: string,
    entityId: string,
    imageId: string,
  ): Promise<ImageResponseDto> {
    const entity = await this.findEntityForUser(userId, entityId);
    const image = await this.prisma.generatedImage.findFirstOrThrow({
      where: { id: imageId, entityId: entity.id },
    });
    const presignedUrl = await this.storage.generatePresignedGetUrl(
      image.storageKey,
    );

    await this.prisma.$transaction([
      this.prisma.generatedImage.updateMany({
        where: { entityId: entity.id, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.generatedImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);

    await this.prisma.entity.update({
      where: { id: entity.id },
      data: { imageUrl: this.storage.getPublicUrl(image.storageKey) },
    });

    return this.toResponse({ ...image, isPrimary: true }, presignedUrl);
  }

  async deleteImage(
    userId: string,
    entityId: string,
    imageId: string,
  ): Promise<void> {
    const entity = await this.findEntityForUser(userId, entityId);
    const image = await this.prisma.generatedImage.findFirstOrThrow({
      where: { id: imageId, entityId: entity.id },
      select: { id: true, storageKey: true, isPrimary: true },
    });
    const nextPrimary = image.isPrimary
      ? await this.prisma.generatedImage.findFirst({
          where: { entityId: entity.id, id: { not: image.id } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, storageKey: true },
        })
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.generatedImage.delete({ where: { id: image.id } });
      if (nextPrimary) {
        await tx.generatedImage.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
      if (image.isPrimary) {
        const nextImageUrl = nextPrimary
          ? this.storage.getPublicUrl(nextPrimary.storageKey)
          : entity.imageUrl === this.storage.getPublicUrl(image.storageKey)
            ? null
            : entity.imageUrl;
        await tx.entity.update({
          where: { id: entity.id },
          data: { imageUrl: nextImageUrl },
        });
      }
    });

    await this.storage.deleteObject(image.storageKey);
  }

  async generatePreviewImage(
    dto: GeneratePreviewImageDto,
  ): Promise<PreviewImageResponseDto> {
    try {
      const prompt = buildSpanishPromptFromData({
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
      });
      const width =
        dto.width ?? Number(this.config.get<string>('IMAGE_WIDTH', '512'));
      const height =
        dto.height ?? Number(this.config.get<string>('IMAGE_HEIGHT', '512'));
      const result = await this.imageGen.generate({ prompt, width, height });
      const ext = MIME_EXTENSIONS[result.contentType] ?? 'jpg';
      const storageKey = `entities/preview/${randomUUID()}.${ext}`;
      const { presignedUrl } = await this.storage.generatePresignedUploadUrl(
        'preview',
        storageKey,
        result.contentType,
        storageKey,
      );
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
      const imageUrl = await this.storage.generatePresignedGetUrl(storageKey);
      return { imageUrl, storageKey, prompt, imageType: result.contentType };
    } catch (err) {
      toUserFriendlyError(err);
    }
  }

  async attachImage(
    userId: string,
    dto: AttachImageDto,
  ): Promise<ImageResponseDto> {
    const entity = await this.findEntityForUser(userId, dto.entityId);
    const image = await this.prisma.generatedImage.create({
      data: {
        entityId: entity.id,
        prompt: dto.prompt,
        storageKey: dto.storageKey,
        imageType: dto.imageType,
        isPrimary: true,
      },
    });
    await this.prisma.generatedImage.updateMany({
      where: { entityId: entity.id, isPrimary: true, id: { not: image.id } },
      data: { isPrimary: false },
    });
    await this.prisma.entity.update({
      where: { id: entity.id },
      data: { imageUrl: this.storage.getPublicUrl(dto.storageKey) },
    });
    return this.toResponse(
      image,
      await this.storage.generatePresignedGetUrl(dto.storageKey),
    );
  }

  private async findEntityForUser(
    userId: string,
    entityId: string,
  ): Promise<{ id: string; imageUrl: string | null }> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true, imageUrl: true },
    });
    if (!entity) {
      throw new NotFoundException('Entity not found');
    }
    return entity;
  }

  private toResponse(
    image: {
      id: string;
      entityId: string;
      prompt: string;
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
