import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ExportFormat, ExportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  EXPORT_SOURCE,
  type ExportSourceRepository,
} from './export-source.port';
import { ExportRendererService } from './export-renderer.service';
import {
  EXPORT_FORMATS,
  type ExportJobRecord,
  type SupportedExportFormat,
} from './export.types';
import { prepareExportDocument } from './tiptap-export';
import { ExportJobResponseDto } from './dto/export-job-response.dto';

const MIME_TYPES: Record<SupportedExportFormat, string> = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  EPUB: 'application/epub+zip',
};

function isSupportedFormat(format: string): format is SupportedExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(format);
}

function imageDetails(storageKey: string): {
  extension: string;
  mimeType: string;
} {
  const extension = storageKey.split('.').pop()?.toLowerCase() ?? 'jpg';
  if (extension === 'png') return { extension: 'png', mimeType: 'image/png' };
  if (extension === 'gif') return { extension: 'gif', mimeType: 'image/gif' };
  if (extension === 'bmp') return { extension: 'bmp', mimeType: 'image/bmp' };
  if (extension === 'webp' || extension === 'avif') {
    throw new Error(
      'Las exportaciones actualmente requieren imágenes JPG o PNG',
    );
  }
  return { extension: 'jpg', mimeType: 'image/jpeg' };
}

function fileSlug(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const slug = normalized
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'obra';
}

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: ExportRendererService,
    @Inject(EXPORT_SOURCE)
    private readonly sourceRepository: ExportSourceRepository,
  ) {}

  async requestExport(
    userId: string,
    projectId: string,
    format: SupportedExportFormat,
  ): Promise<ExportJobResponseDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exportJob.create({
        data: {
          projectId,
          userId,
          format: format as ExportFormat,
          scopeType: 'PROJECT',
          template: 'classic',
          options: { includeImages: true },
        },
      });

      await tx.outbox.create({
        data: {
          aggregateType: 'ExportJob',
          aggregateId: created.id,
          eventType: 'export.requested',
          payload: { exportJobId: created.id, projectId, userId },
          createdAt: new Date(),
        },
      });

      return created;
    });

    return ExportJobResponseDto.from(this.toRecord(job));
  }

  async getExportStatus(
    userId: string,
    projectId: string,
    exportJobId: string,
  ): Promise<ExportJobResponseDto> {
    const job = await this.prisma.exportJob.findFirst({
      where: { id: exportJobId, projectId, userId },
      include: { project: { select: { title: true } } },
    });

    if (!job) {
      throw new NotFoundException('Export job not found');
    }

    const record = this.toRecord(job);
    const downloadUrl =
      record.status === ExportStatus.COMPLETED && record.storageKey
        ? await this.storage.generatePresignedGetUrl(record.storageKey, {
            responseContentType:
              MIME_TYPES[record.format as SupportedExportFormat],
            downloadName: `${fileSlug(job.project.title)}.${record.format.toLowerCase()}`,
          })
        : null;

    return ExportJobResponseDto.from(record, downloadUrl);
  }

  async processExport(exportJobId: string): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!job || job.status === ExportStatus.COMPLETED) return;

    const claimed = await this.prisma.exportJob.updateMany({
      where: {
        id: exportJobId,
        status: {
          in: [
            ExportStatus.QUEUED,
            ExportStatus.PROCESSING,
            ExportStatus.FAILED,
          ],
        },
      },
      data: {
        status: ExportStatus.PROCESSING,
        progress: 5,
        errorMessage: null,
      },
    });

    if (claimed.count === 0) return;

    try {
      if (!isSupportedFormat(job.format)) {
        throw new Error(`Unsupported export format: ${job.format}`);
      }

      const source = await this.sourceRepository.findByIdForUser(
        job.userId,
        job.projectId,
      );
      if (!source) throw new NotFoundException('Project not found');

      await this.updateProgress(exportJobId, 20);
      const imageCache = new Map<
        string,
        ReturnType<typeof imageDetails> & { buffer: Buffer }
      >();
      const document = await prepareExportDocument(
        source,
        async (storageKey, sceneId) => {
          if (!sceneId || !storageKey.startsWith(`scenes/${sceneId}/`)) {
            throw new Error('Invalid image reference in export');
          }

          const cached = imageCache.get(storageKey);
          if (cached) return cached;

          const image = {
            ...imageDetails(storageKey),
            buffer: await this.storage.getBuffer(storageKey),
          };
          imageCache.set(storageKey, image);
          return image;
        },
      );

      await this.updateProgress(exportJobId, 55);
      const rendered = await this.renderer.render(job.format, document);
      const storageKey = `exports/${job.projectId}/${job.id}.${job.format.toLowerCase()}`;
      await this.storage.putBuffer(
        storageKey,
        rendered.buffer,
        rendered.contentType,
        `attachment; filename="${fileSlug(source.title)}.${job.format.toLowerCase()}"`,
      );
      await this.updateProgress(exportJobId, 90);

      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: ExportStatus.COMPLETED,
          progress: 100,
          storageKey,
          fileSizeBytes: BigInt(rendered.buffer.byteLength),
          errorMessage: null,
          completedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: ExportStatus.FAILED,
          progress: 100,
          errorMessage:
            error instanceof Error ? error.message : 'Export failed',
        },
      });
      throw error;
    }
  }

  private async updateProgress(
    exportJobId: string,
    progress: number,
  ): Promise<void> {
    await this.prisma.exportJob.update({
      where: { id: exportJobId },
      data: { progress },
    });
  }

  private toRecord(job: {
    id: string;
    projectId: string;
    format: ExportFormat;
    status: ExportStatus;
    progress: number;
    errorMessage: string | null;
    storageKey: string | null;
    fileSizeBytes: bigint | null;
    createdAt: Date;
    completedAt: Date | null;
  }): ExportJobRecord {
    return {
      id: job.id,
      projectId: job.projectId,
      format: job.format,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      storageKey: job.storageKey,
      fileSizeBytes: job.fileSizeBytes,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }
}
