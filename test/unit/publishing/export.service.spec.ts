import { ExportFormat, ExportStatus } from '@prisma/client';
import { ExportService } from '../../../src/publishing/exports/export.service';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';

describe('ExportService', () => {
  const containing = <T>(value: T): T => expect.objectContaining(value) as T;

  const prisma = {
    book: { findFirst: jest.fn(), findUnique: jest.fn() },
    exportJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    outbox: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = {
    getBuffer: jest.fn(),
    putBuffer: jest.fn(),
    generatePresignedGetUrl: jest.fn(),
  };
  const renderer = { render: jest.fn() };
  const exportSettings = {
    getEffectiveConfig: jest.fn().mockResolvedValue(DEFAULT_EXPORT_SETTINGS),
  };
  const source = { findByIdForUser: jest.fn() };

  const service = new ExportService(
    prisma as never,
    storage as never,
    renderer as never,
    exportSettings as never,
    source,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a book export job and its outbox event', async () => {
    prisma.book.findFirst.mockResolvedValue({ id: 'book-id' });
    const job = {
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
      progress: 0,
      errorMessage: null,
      storageKey: null,
      fileSizeBytes: null,
      createdAt: new Date(),
      completedAt: null,
    };
    prisma.exportJob.create.mockResolvedValue(job);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );

    const result = await service.requestExport(
      'user-id',
      'project-id',
      'book-id',
      'PDF',
    );

    expect(result).toMatchObject({
      id: 'job-id',
      projectId: 'project-id',
      bookId: 'book-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    expect(prisma.book.findFirst).toHaveBeenCalledWith(
      containing({
        where: containing({
          id: 'book-id',
          projectId: 'project-id',
        }),
      }),
    );
    expect(prisma.exportJob.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          projectId: 'project-id',
          userId: 'user-id',
          format: ExportFormat.PDF,
          scopeType: 'BOOK',
          scopeId: 'book-id',
        }),
      }),
    );
    expect(prisma.outbox.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          aggregateType: 'ExportJob',
          aggregateId: 'job-id',
          eventType: 'export.requested',
        }),
      }),
    );
  });

  it('rejects when the book does not belong to the project or user', async () => {
    prisma.book.findFirst.mockResolvedValue(null);

    await expect(
      service.requestExport('user-id', 'project-id', 'book-id', 'PDF'),
    ).rejects.toThrow('Book not found');
  });

  it('does not expose a job that belongs to another project, book or user', async () => {
    prisma.exportJob.findFirst.mockResolvedValue(null);

    await expect(
      service.getExportStatus('other-user', 'project-id', 'book-id', 'job-id'),
    ).rejects.toThrow('Export job not found');
  });

  it('renders, stores and completes a queued export', async () => {
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      userId: 'user-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.exportJob.update.mockResolvedValue({});
    source.findByIdForUser.mockResolvedValue({
      id: 'book-id',
      title: 'La obra',
      chapters: [],
    });
    renderer.render.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
      extension: 'PDF',
    });

    await service.processExport('job-id');

    expect(source.findByIdForUser).toHaveBeenCalledWith('user-id', 'book-id');
    expect(renderer.render).toHaveBeenCalledWith(
      ExportFormat.PDF,
      containing({ title: 'La obra', chapters: [] }),
      DEFAULT_EXPORT_SETTINGS,
    );
    expect(storage.putBuffer).toHaveBeenCalledWith(
      'exports/project-id/job-id.pdf',
      Buffer.from('pdf'),
      'application/pdf',
      expect.stringContaining('la-obra.pdf'),
    );
    expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
      containing({
        where: { id: 'job-id' },
        data: containing({
          status: ExportStatus.COMPLETED,
          progress: 100,
          storageKey: 'exports/project-id/job-id.pdf',
        }),
      }),
    );
  });
});
