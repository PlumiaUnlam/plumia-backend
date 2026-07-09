import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IMAGE_GENERATION } from './ports/image-generation.port';
import type {
  ImageGeneration,
  ImageGenerationInput,
  ImageGenerationResult,
} from './ports/image-generation.port';
import type { GenerateImageDto } from './dto/generate-image.dto';
import type { ImageResponseDto } from './dto/image-response.dto';
import type { GeneratePreviewImageDto } from './dto/generate-preview-image.dto';
import type { PreviewImageResponseDto } from './dto/preview-image-response.dto';
import type { AttachImageDto } from './dto/attach-image.dto';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const TYPE_TO_SPANISH: Record<string, { noun: string; article: string }> = {
  CHARACTER: { noun: 'personaje', article: 'un' },
  LOCATION: { noun: 'lugar', article: 'un' },
  OBJECT: { noun: 'objeto', article: 'un' },
  ORGANIZATION: { noun: 'organización', article: 'una' },
  EVENT: { noun: 'evento', article: 'un' },
  CONCEPT: { noun: 'concepto', article: 'un' },
};

const UPLOAD_TIMEOUT_MS = 10_000;

function toUserFriendlyError(err: unknown): never {
  if (err instanceof Error) {
    if (err.message.includes('timeout')) {
      throw new HttpException(
        'La generación de la imagen tardó demasiado. Intentá de nuevo.',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    if (err.message.includes('Pollinations API error')) {
      throw new HttpException(
        'El servicio de generación de imágenes no está disponible en este momento.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (err.message.includes('Failed to upload image to storage')) {
      throw new HttpException(
        'Error al guardar la imagen generada. Intentá de nuevo.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
  throw new HttpException(
    'Error al generar la imagen. Intentá de nuevo más tarde.',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${options.timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class PublishingService {
  constructor(
    @Inject(IMAGE_GENERATION)
    private readonly imageGen: ImageGeneration,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async generateImage(dto: GenerateImageDto): Promise<ImageResponseDto> {
    const entity = await this.prisma.entity.findUniqueOrThrow({
      where: { id: dto.entityId },
      select: {
        id: true,
        canonicalName: true,
        description: true,
        type: true,
        imageUrl: true,
      },
    });

    const prompt = this.buildSpanishPrompt(entity);

    const width =
      dto.width ?? Number(this.config.get<string>('IMAGE_WIDTH', '512'));
    const height =
      dto.height ?? Number(this.config.get<string>('IMAGE_HEIGHT', '512'));

    let imgResult: ImageGenerationResult;
    try {
      const input: ImageGenerationInput = {
        prompt,
        width,
        height,
      };
      imgResult = await this.imageGen.generate(input);
    } catch (err) {
      toUserFriendlyError(err);
    }

    const ext = MIME_EXTENSIONS[imgResult.contentType] ?? 'jpg';
    const storageKey = `entities/${entity.id}/generated/${randomUUID()}.${ext}`;

    let presignedUrl: string;
    let publicUrl: string;
    try {
      const urls = await this.storage.generatePresignedUploadUrl(
        entity.id,
        storageKey,
        imgResult.contentType,
        storageKey,
      );
      presignedUrl = urls.presignedUrl;
      publicUrl = urls.publicUrl;
    } catch (err) {
      toUserFriendlyError(err);
    }

    const uploadResponse = await fetchWithTimeout(presignedUrl, {
      method: 'PUT',
      body: new Uint8Array(imgResult.buffer),
      headers: { 'Content-Type': imgResult.contentType },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload image to storage: ${uploadResponse.status}`,
      );
    }

    const image = await this.prisma.generatedImage.create({
      data: {
        entityId: entity.id,
        prompt,
        storageKey,
        imageType: imgResult.contentType,
        isPrimary: !entity.imageUrl,
      },
    });

    if (!entity.imageUrl) {
      await this.prisma.entity.update({
        where: { id: entity.id },
        data: { imageUrl: publicUrl },
      });
    }

    const presignedGetUrl =
      await this.storage.generatePresignedGetUrl(storageKey);
    return this.toResponse(image, presignedGetUrl);
  }

  async listImages(entityId: string): Promise<ImageResponseDto[]> {
    const entity = await this.prisma.entity.findUniqueOrThrow({
      where: { id: entityId },
      select: { id: true },
    });

    const images = await this.prisma.generatedImage.findMany({
      where: { entityId: entity.id },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      images.map(async (img) => {
        const presignedUrl = await this.storage.generatePresignedGetUrl(
          img.storageKey,
        );
        return this.toResponse(img, presignedUrl);
      }),
    );
  }

  async setPrimaryImage(
    entityId: string,
    imageId: string,
  ): Promise<ImageResponseDto> {
    const image = await this.prisma.generatedImage.findFirstOrThrow({
      where: { id: imageId, entityId },
    });

    const presignedUrl = await this.storage.generatePresignedGetUrl(
      image.storageKey,
    );

    await this.prisma.$transaction([
      this.prisma.generatedImage.updateMany({
        where: { entityId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.generatedImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);

    await this.prisma.entity.update({
      where: { id: entityId },
      data: { imageUrl: presignedUrl },
    });

    return this.toResponse(image, presignedUrl);
  }

  async generatePreviewImage(
    dto: GeneratePreviewImageDto,
  ): Promise<PreviewImageResponseDto> {
    try {
      const prompt = this.buildSpanishPromptFromData({
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
      });

      const width =
        dto.width ?? Number(this.config.get<string>('IMAGE_WIDTH', '512'));
      const height =
        dto.height ?? Number(this.config.get<string>('IMAGE_HEIGHT', '512'));

      const input: ImageGenerationInput = { prompt, width, height };
      const result = await this.imageGen.generate(input);

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

  async attachImage(dto: AttachImageDto): Promise<ImageResponseDto> {
    const entity = await this.prisma.entity.findUniqueOrThrow({
      where: { id: dto.entityId },
      select: { id: true, imageUrl: true },
    });

    const image = await this.prisma.generatedImage.create({
      data: {
        entityId: entity.id,
        prompt: dto.prompt,
        storageKey: dto.storageKey,
        imageType: dto.imageType,
        isPrimary: true,
      },
    });

    await this.prisma.$transaction([
      this.prisma.generatedImage.updateMany({
        where: { entityId: entity.id, isPrimary: true, id: { not: image.id } },
        data: { isPrimary: false },
      }),
    ]);

    const publicUrl = this.storage.getPublicUrl(dto.storageKey);

    await this.prisma.entity.update({
      where: { id: entity.id },
      data: { imageUrl: publicUrl },
    });

    const presignedGetUrl = await this.storage.generatePresignedGetUrl(
      dto.storageKey,
    );

    return this.toResponse(image, presignedGetUrl);
  }

  private buildSpanishPromptFromData(data: {
    name: string;
    description: string | null;
    type: string;
  }): string {
    const { noun, article } = TYPE_TO_SPANISH[data.type] ?? {
      noun: 'entidad',
      article: 'una',
    };
    const parts: string[] = [`Ilustración realista de ${article} ${noun}`];
    if (data.description) {
      parts.push(data.description);
    }
    parts.push(
      'Sin texto, sin letras, sin palabras, sin tipografía, sin escritura sobre la imagen. Estilo realista, alta calidad',
    );
    return parts.join('. ');
  }

  private buildSpanishPrompt(entity: {
    canonicalName: string;
    description: string | null;
    type: string;
  }): string {
    const { noun, article } = TYPE_TO_SPANISH[entity.type] ?? {
      noun: 'entidad',
      article: 'una',
    };
    const parts: string[] = [`Ilustración realista de ${article} ${noun}`];
    if (entity.description) {
      parts.push(entity.description);
    }
    parts.push(
      'Sin texto, sin letras, sin palabras, sin tipografía, sin escritura sobre la imagen. Estilo realista, alta calidad',
    );
    return parts.join('. ');
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
