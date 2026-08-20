import type { ImageGenerationJobStatus } from '@prisma/client';
import type { ImageResponseDto } from './image-response.dto';

export interface ImageGenerationJobRecord {
  id: string;
  entityId: string;
  status: ImageGenerationJobStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  generatedImage: ImageResponseDto | null;
}

export class ImageGenerationJobResponseDto {
  id!: string;
  entityId!: string;
  status!: ImageGenerationJobStatus;
  progress!: number;
  errorMessage!: string | null;
  createdAt!: Date;
  startedAt!: Date | null;
  completedAt!: Date | null;
  generatedImage!: ImageResponseDto | null;

  static from(record: ImageGenerationJobRecord): ImageGenerationJobResponseDto {
    return {
      id: record.id,
      entityId: record.entityId,
      status: record.status,
      progress: record.progress,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      generatedImage: record.generatedImage,
    };
  }
}
