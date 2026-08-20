import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Request,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import type { AuthenticatedRequest } from './authenticated-request';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const STORAGE_KEY_PATTERN = /^(entities|scenes)\/([^/]+)\/[^/]+$/;

class PresignedUploadDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsIn(ALLOWED_MIME)
  contentType!: string;

  @IsString()
  @IsOptional()
  existingImageUrl?: string;

  @IsString()
  @IsOptional()
  @IsIn(['entities', 'scenes'])
  storageFolder?: 'entities' | 'scenes';
}

class PresignedDownloadDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;
}

class PresignedDownloadByKeyDto {
  @IsString()
  @IsNotEmpty()
  storageKey!: string;
}

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  @Post('presigned-upload')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async presignedUpload(
    @Request() _req: AuthenticatedRequest,
    @Body() dto: PresignedUploadDto,
  ): Promise<{ presignedUrl: string; publicUrl: string; storageKey: string }> {
    try {
      const existingKey = dto.existingImageUrl
        ? this.storageService.extractKeyFromUrl(dto.existingImageUrl)
        : undefined;
      const res = await this.storageService.generatePresignedUploadUrl(
        dto.entityId,
        dto.filename,
        dto.contentType,
        existingKey,
        dto.storageFolder ?? 'entities',
      );
      return res;
    } catch (err) {
      throw new HttpException(
        (err as Error).message || 'Failed to generate upload URL',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('presigned-download-by-key')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async presignedDownloadByKey(
    @Request() req: AuthenticatedRequest,
    @Body() dto: PresignedDownloadByKeyDto,
  ): Promise<{ url: string }> {
    const match = STORAGE_KEY_PATTERN.exec(dto.storageKey);

    if (!match) {
      throw new HttpException('Invalid storage key', HttpStatus.BAD_REQUEST);
    }

    const scope = match[1] as 'entities' | 'scenes';
    const resourceId = match[2];

    if (!resourceId) {
      throw new HttpException('Invalid storage key', HttpStatus.BAD_REQUEST);
    }

    if (scope === 'entities') {
      const entity = await this.prisma.entity.findFirst({
        where: { id: resourceId, deletedAt: null },
        select: {
          id: true,
          project: { select: { userId: true } },
        },
      });

      if (!entity) {
        throw new HttpException('Entity not found', HttpStatus.NOT_FOUND);
      }

      if (entity.project.userId !== req.user.id) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
    } else {
      const scene = await this.prisma.scene.findFirst({
        where: { id: resourceId, deletedAt: null },
        select: {
          id: true,
          chapter: {
            select: {
              book: {
                select: {
                  project: { select: { userId: true } },
                },
              },
            },
          },
        },
      });

      if (!scene) {
        throw new HttpException('Scene not found', HttpStatus.NOT_FOUND);
      }

      if (scene.chapter.book.project.userId !== req.user.id) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
    }

    const url = await this.storageService.generatePresignedGetUrl(
      dto.storageKey,
    );

    return { url };
  }

  @Post('presigned-download')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async presignedDownload(
    @Request() req: AuthenticatedRequest,
    @Body() dto: PresignedDownloadDto,
  ): Promise<{ url: string }> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: dto.entityId },
      select: {
        imageUrl: true,
        project: { select: { userId: true } },
      },
    });

    if (!entity) {
      throw new HttpException('Entity not found', HttpStatus.NOT_FOUND);
    }

    if (!entity.imageUrl) {
      throw new HttpException('Entity has no image', HttpStatus.BAD_REQUEST);
    }

    if (entity.project.userId !== req.user.id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const key = this.storageService.extractKeyFromUrl(entity.imageUrl);
    const url = await this.storageService.generatePresignedGetUrl(key);

    return { url };
  }

  @Get('image/:entityId')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async getImage(
    @Param('entityId') entityId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const sessionToken = extractStorageToken(req);

    if (!sessionToken) {
      throw new UnauthorizedException();
    }

    const decoded = await this.firebaseAdmin.verifyToken(sessionToken);

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.uid },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: {
        imageUrl: true,
        project: { select: { userId: true } },
      },
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    if (!entity.imageUrl) {
      throw new BadRequestException('Entity has no image');
    }

    if (entity.project.userId !== user.id) {
      throw new ForbiddenException();
    }

    const key = this.storageService.extractKeyFromUrl(entity.imageUrl);
    const url = await this.storageService.generatePresignedGetUrl(key);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.redirect(302, url);
  }
}

function extractStorageToken(req: AuthenticatedRequest): string | null {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) {
      return token;
    }
  }

  const cookie = req.headers.cookie ?? '';
  return (
    cookie
      .split(';')
      .find((value: string) => value.trim().startsWith('__session='))
      ?.split('=', 2)[1] ?? null
  );
}
