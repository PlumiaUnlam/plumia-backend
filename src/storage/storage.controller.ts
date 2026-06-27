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
}

class PresignedDownloadDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;
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
  ): Promise<{ presignedUrl: string; publicUrl: string }> {
    try {
      const existingKey = dto.existingImageUrl
        ? this.storageService.extractKeyFromUrl(dto.existingImageUrl)
        : undefined;
      const res = await this.storageService.generatePresignedUploadUrl(
        dto.entityId,
        dto.filename,
        dto.contentType,
        existingKey,
      );
      return res;
    } catch (err) {
      throw new HttpException(
        (err as Error).message || 'Failed to generate upload URL',
        HttpStatus.BAD_REQUEST,
      );
    }
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
    const cookie = (req.headers['cookie'] as string | undefined) ?? '';
    const sessionToken = cookie
      .split(';')
      .find((c: string) => c.trim().startsWith('__session='))
      ?.split('=', 2)[1];

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
