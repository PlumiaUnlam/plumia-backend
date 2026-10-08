import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExportFormat, ExportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  EXPORT_SOURCE,
  type ExportSourceRepository,
} from './export-source.port';
import {
  EXPORT_FORMATS,
  type ExportImage,
  type ExportJobRecord,
  type SupportedExportFormat,
} from './export.types';
import { DEFAULT_EXPORT_AUTHOR, prepareExportDocument } from './tiptap-export';
import { EpubExportRenderer } from './renderers/epub-export.renderer';
import { ExportJobResponseDto } from './dto/export-job-response.dto';

const MIME_TYPES: Record<SupportedExportFormat, string> = {
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
  if (extension === 'png') {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (extension === 'gif') {
    return { extension: 'gif', mimeType: 'image/gif' };
  }
  if (extension === 'bmp') {
    return { extension: 'bmp', mimeType: 'image/bmp' };
  }
  if (extension === 'webp' || extension === 'avif') {
    throw new Error(
      'Las exportaciones actualmente requieren imágenes JPG o PNG',
    );
  }
  return { extension: 'jpg', mimeType: 'image/jpeg' };
}

function fileSlug(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let slug = normalized.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  if (slug.startsWith('-')) {
    slug = slug.slice(1);
  }
  if (slug.endsWith('-')) {
    slug = slug.slice(0, -1);
  }
  return slug || 'obra';
}

function exportAuthor(user: {
  name: string;
  lastname: string;
  displayName: string | null;
}): string {
  const displayName = user.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  const fullName = `${user.name} ${user.lastname}`.replace(/\s+/g, ' ').trim();
  return fullName || DEFAULT_EXPORT_AUTHOR;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: EpubExportRenderer,
    @Inject(EXPORT_SOURCE)
    private readonly sourceRepository: ExportSourceRepository,
  ) {}

  async requestExport(
    userId: string,
    projectId: string,
    bookId: string,
    format: SupportedExportFormat,
  ): Promise<ExportJobResponseDto> {
    const book = await this.prisma.book.findFirst({
      where: {
        id: bookId,
        projectId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true },
    });

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exportJob.create({
        data: {
          projectId,
          userId,
          format,
          scopeType: 'BOOK',
          scopeId: bookId,
          template: 'classic',
          options: { includeImages: true },
        },
      });

      await tx.outbox.create({
        data: {
          aggregateType: 'ExportJob',
          aggregateId: created.id,
          eventType: 'export.requested',
          payload: { exportJobId: created.id, projectId, bookId, userId },
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
    bookId: string,
    exportJobId: string,
  ): Promise<ExportJobResponseDto> {
    const job = await this.prisma.exportJob.findFirst({
      where: { id: exportJobId, projectId, scopeId: bookId, userId },
    });

    if (!job) {
      throw new NotFoundException('Export job not found');
    }

    const record = this.toRecord(job);
    let downloadUrl: string | null = null;
    if (record.status === ExportStatus.COMPLETED && record.storageKey) {
      const book = await this.prisma.book.findUnique({
        where: { id: bookId },
        select: { title: true },
      });
      downloadUrl = await this.storage.generatePresignedGetUrl(
        record.storageKey,
        {
          responseContentType:
            MIME_TYPES[record.format as SupportedExportFormat],
          downloadName: `${fileSlug(book?.title ?? 'obra')}.${record.format.toLowerCase()}`,
        },
      );
    }

    return ExportJobResponseDto.from(record, downloadUrl);
  }

  async processExport(exportJobId: string): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!job || job.status === ExportStatus.COMPLETED) {
      return;
    }

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

    if (claimed.count === 0) {
      return;
    }

    try {
      if (!isSupportedFormat(job.format)) {
        throw new Error(`Unsupported export format: ${job.format}`);
      }

      if (!job.scopeId) {
        throw new Error('Export job is missing a book scopeId');
      }
      const source = await this.sourceRepository.findByIdForUser(
        job.userId,
        job.scopeId,
      );
      if (!source) {
        throw new NotFoundException('Book not found');
      }

      await this.updateProgress(exportJobId, 20);
      const imageCache = new Map<
        string,
        Promise<ReturnType<typeof imageDetails> & { buffer: Buffer }>
      >();
      const document = await prepareExportDocument(
        source,
        async (storageKey, sceneId) => {
          if (!sceneId || !storageKey.startsWith(`scenes/${sceneId}/`)) {
            throw new Error('Invalid image reference in export');
          }

          const cached = imageCache.get(storageKey);
          if (cached) {
            return cached;
          }

          const image = this.loadExportImage(storageKey);
          imageCache.set(storageKey, image);
          return image;
        },
        {
          author: exportAuthor(source.project.user),
          cover: await this.loadCover(source.id, source.coverStorageKey),
        },
      );

      await this.updateProgress(exportJobId, 55);
      const rendered = await this.renderer.render(document);
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

  /**
   * La portada es opcional: si no se puede cargar, el export sigue sin ella
   * en vez de fallar.
   */
  private async loadCover(
    bookId: string,
    coverStorageKey: string | null,
  ): Promise<ExportImage | null> {
    if (!coverStorageKey) {
      return null;
    }
    if (!coverStorageKey.startsWith(`books/${bookId}/`)) {
      this.logger.warn(
        `Portada ignorada: la clave ${coverStorageKey} no pertenece al libro ${bookId}`,
      );
      return null;
    }

    try {
      return await this.loadExportImage(coverStorageKey);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo cargar la portada ${coverStorageKey}; se exporta sin portada: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async loadExportImage(
    storageKey: string,
  ): Promise<ReturnType<typeof imageDetails> & { buffer: Buffer }> {
    return {
      ...imageDetails(storageKey),
      buffer: await this.storage.getBuffer(storageKey),
    };
  }

  private toRecord(job: {
    id: string;
    projectId: string;
    scopeId: string | null;
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
      bookId: job.scopeId,
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
