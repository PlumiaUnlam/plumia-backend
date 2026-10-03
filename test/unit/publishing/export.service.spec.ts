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

  it('provides downloads only after a completed export exists', async () => {
    const completed = {
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      format: ExportFormat.PDF,
      status: ExportStatus.COMPLETED,
      progress: 100,
      errorMessage: null,
      storageKey: 'exports/project-id/job-id.pdf',
      fileSizeBytes: 123n,
      createdAt: new Date(),
      completedAt: new Date(),
    };
    prisma.exportJob.findFirst.mockResolvedValue(completed);
    prisma.book.findUnique.mockResolvedValue({ title: 'L’été — À nous' });
    storage.generatePresignedGetUrl.mockResolvedValue(
      'https://download.example/book.pdf',
    );

    await expect(
      service.getExportStatus('user-id', 'project-id', 'book-id', 'job-id'),
    ).resolves.toMatchObject({
      id: 'job-id',
      status: ExportStatus.COMPLETED,
      downloadUrl: 'https://download.example/book.pdf',
    });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      completed.storageKey,
      {
        responseContentType: 'application/pdf',
        downloadName: 'l-ete-a-nous.pdf',
      },
    );

    prisma.exportJob.findFirst.mockResolvedValue({
      ...completed,
      status: ExportStatus.PROCESSING,
      storageKey: null,
    });
    await expect(
      service.getExportStatus('user-id', 'project-id', 'book-id', 'job-id'),
    ).resolves.toMatchObject({ downloadUrl: null });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledTimes(1);
  });

  it('skips absent, completed, and unclaimable export jobs', async () => {
    prisma.exportJob.findUnique.mockResolvedValue(null);
    await expect(service.processExport('missing')).resolves.toBeUndefined();
    prisma.exportJob.findUnique.mockResolvedValue({
      status: ExportStatus.COMPLETED,
    });
    await expect(service.processExport('completed')).resolves.toBeUndefined();
    expect(prisma.exportJob.updateMany).not.toHaveBeenCalled();

    prisma.exportJob.findUnique.mockResolvedValue({
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.processExport('claimed-elsewhere'),
    ).resolves.toBeUndefined();
    expect(source.findByIdForUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ format: 'TXT', scopeId: 'book-id' }, 'Unsupported export format: TXT'],
    [
      { format: ExportFormat.PDF, scopeId: null },
      'Export job is missing a book scopeId',
    ],
  ])(
    'marks invalid export jobs as failed (%j)',
    async (jobDetails, message) => {
      prisma.exportJob.findUnique.mockResolvedValue({
        id: 'job-id',
        projectId: 'project-id',
        userId: 'user-id',
        status: ExportStatus.QUEUED,
        ...jobDetails,
      });
      prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.processExport('job-id')).rejects.toThrow(message);
      expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
        containing({
          where: { id: 'job-id' },
          data: containing({
            status: ExportStatus.FAILED,
            progress: 100,
            errorMessage: message,
          }),
        }),
      );
    },
  );

  it('marks an export failed when its book source has been removed', async () => {
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      userId: 'user-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    source.findByIdForUser.mockResolvedValue(null);

    await expect(service.processExport('job-id')).rejects.toThrow(
      'Book not found',
    );
    expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
      containing({
        data: containing({
          status: ExportStatus.FAILED,
          errorMessage: 'Book not found',
        }),
      }),
    );
  });

  it('caches repeated image reads and rejects unsafe scene references or unsupported image formats', async () => {
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      userId: 'user-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    source.findByIdForUser.mockResolvedValue({
      id: 'book-id',
      title: 'Book',
      chapters: [
        {
          title: 'Chapter',
          scenes: [
            {
              id: 'scene-1',
              title: 'Scene',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'image',
                    attrs: {
                      storageKey: 'scenes/scene-1/cover.png',
                      alt: 'Cover',
                    },
                  },
                  {
                    type: 'image',
                    attrs: {
                      storageKey: 'scenes/scene-1/cover.png',
                      alt: 'Same cover',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    storage.getBuffer.mockResolvedValue(Buffer.from('image'));
    renderer.render.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
      extension: 'PDF',
    });

    await service.processExport('job-id');
    expect(storage.getBuffer).toHaveBeenCalledTimes(1);
    expect(storage.getBuffer).toHaveBeenCalledWith('scenes/scene-1/cover.png');

    for (const storageKey of [
      'entities/entity-1/cover.png',
      'scenes/scene-1/cover.webp',
    ]) {
      prisma.exportJob.update.mockClear();
      source.findByIdForUser.mockResolvedValue({
        id: 'book-id',
        title: 'Book',
        chapters: [
          {
            title: 'Chapter',
            scenes: [
              {
                id: 'scene-1',
                title: 'Scene',
                content: {
                  type: 'doc',
                  content: [{ type: 'image', attrs: { storageKey } }],
                },
              },
            ],
          },
        ],
      });
      await expect(service.processExport('job-id')).rejects.toThrow(
        storageKey.endsWith('.webp')
          ? 'Las exportaciones actualmente requieren imágenes JPG o PNG'
          : 'Invalid image reference in export',
      );
      expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
        containing({ data: containing({ status: ExportStatus.FAILED }) }),
      );
    }
  });
});
