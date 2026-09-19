import type { ExportFormat, ExportStatus } from '@prisma/client';
import type { ExportJobRecord } from '../export.types';

export class ExportJobResponseDto {
  id!: string;
  projectId!: string;
  format!: ExportFormat;
  status!: ExportStatus;
  progress!: number;
  errorMessage!: string | null;
  downloadUrl!: string | null;
  createdAt!: Date;
  completedAt!: Date | null;

  static from(
    record: ExportJobRecord,
    downloadUrl: string | null = null,
  ): ExportJobResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      format: record.format,
      status: record.status,
      progress: record.progress,
      errorMessage: record.errorMessage,
      downloadUrl,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    };
  }
}
