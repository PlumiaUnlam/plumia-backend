import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GeneratePreviewImageDto } from './dto/generate-preview-image.dto';
import { PreviewImageResponseDto } from './dto/preview-image-response.dto';
import { AttachImageDto } from './dto/attach-image.dto';
import { SetPrimaryImageDto } from './dto/set-primary-image.dto';
import { ImageResponseDto } from './dto/image-response.dto';

@Controller('publishing/images')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateImageDto): Promise<ImageResponseDto> {
    return this.publishingService.generateImage(dto);
  }

  @Post('generate-preview')
  async generatePreview(
    @Body() dto: GeneratePreviewImageDto,
  ): Promise<PreviewImageResponseDto> {
    return this.publishingService.generatePreviewImage(dto);
  }

  @Post('attach')
  async attach(@Body() dto: AttachImageDto): Promise<ImageResponseDto> {
    return this.publishingService.attachImage(dto);
  }

  @Get(':entityId')
  async list(@Param('entityId') entityId: string): Promise<ImageResponseDto[]> {
    return this.publishingService.listImages(entityId);
  }

  @Post(':entityId/primary')
  async setPrimary(
    @Param('entityId') entityId: string,
    @Body() dto: SetPrimaryImageDto,
  ): Promise<ImageResponseDto> {
    return this.publishingService.setPrimaryImage(entityId, dto.imageId);
  }
}
