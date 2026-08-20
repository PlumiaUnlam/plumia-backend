import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GeneratePreviewImageDto } from './dto/generate-preview-image.dto';
import { PreviewImageResponseDto } from './dto/preview-image-response.dto';
import { AttachImageDto } from './dto/attach-image.dto';
import { SetPrimaryImageDto } from './dto/set-primary-image.dto';
import { ImageResponseDto } from './dto/image-response.dto';
import { ImageGenerationJobResponseDto } from './dto/image-generation-job-response.dto';
import type { AuthenticatedRequest } from '../manuscript/controllers/authenticated-request';
import { ImageGenerationEventsService } from './workers/image-generation-events.service';

@Controller('publishing/images')
export class PublishingController {
  constructor(
    private readonly publishingService: PublishingService,
    private readonly imageEvents: ImageGenerationEventsService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @Request() req: AuthenticatedRequest,
    @Body() dto: GenerateImageDto,
  ): Promise<ImageGenerationJobResponseDto> {
    return ImageGenerationJobResponseDto.from(
      await this.publishingService.requestImageGeneration(req.user.id, dto),
    );
  }

  @Get('jobs/:jobId')
  async getGenerationJob(
    @Request() req: AuthenticatedRequest,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<ImageGenerationJobResponseDto> {
    return ImageGenerationJobResponseDto.from(
      await this.publishingService.getImageGenerationJob(req.user.id, jobId),
    );
  }

  @Get('primary')
  async listPrimary(
    @Request() req: AuthenticatedRequest,
    @Query('entityIds') entityIds?: string,
  ): Promise<ImageResponseDto[]> {
    const ids = (entityIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.publishingService.listPrimaryImages(req.user.id, ids);
  }

  @Sse('events')
  events(@Request() req: AuthenticatedRequest): Observable<MessageEvent> {
    return this.imageEvents.streamForUser(req.user.id);
  }

  @Post('generate-preview')
  async generatePreview(
    @Body() dto: GeneratePreviewImageDto,
  ): Promise<PreviewImageResponseDto> {
    return this.publishingService.generatePreviewImage(dto);
  }

  @Post('attach')
  async attach(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AttachImageDto,
  ): Promise<ImageResponseDto> {
    return this.publishingService.attachImage(req.user.id, dto);
  }

  @Get(':entityId')
  async list(
    @Request() req: AuthenticatedRequest,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ): Promise<ImageResponseDto[]> {
    return this.publishingService.listImages(req.user.id, entityId);
  }

  @Post(':entityId/primary')
  async setPrimary(
    @Request() req: AuthenticatedRequest,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: SetPrimaryImageDto,
  ): Promise<ImageResponseDto> {
    return this.publishingService.setPrimaryImage(
      req.user.id,
      entityId,
      dto.imageId,
    );
  }

  @Delete(':entityId/:imageId')
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    await this.publishingService.deleteImage(req.user.id, entityId, imageId);
  }
}
