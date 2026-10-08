import { ExportFormat, ExportStatus } from '@prisma/client';
import { ExportService } from '../../../src/publishing/exports/export.service';

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
  const source = { findByIdForUser: jest.fn() };
  const sourceMeta = {
    coverStorageKey: null as string | null,
    project: {
      user: { name: 'Ana', lastname: 'Pérez', displayName: null },
    },
  };

  const service = new ExportService(
    prisma as never,
    storage as never,
    renderer as never,
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
      format: ExportFormat.EPUB,
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
      'EPUB',
    );

    expect(result).toMatchObject({
      id: 'job-id',
      projectId: 'project-id',
      bookId: 'book-id',
      format: ExportFormat.EPUB,
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
          format: ExportFormat.EPUB,
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
      service.requestExport('user-id', 'project-id', 'book-id', 'EPUB'),
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
      format: ExportFormat.EPUB,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.exportJob.update.mockResolvedValue({});
    source.findByIdForUser.mockResolvedValue({
      ...sourceMeta,
      id: 'book-id',
      title: 'La obra',
      chapters: [],
    });
    renderer.render.mockResolvedValue({
      buffer: Buffer.from('epub'),
      contentType: 'application/epub+zip',
      extension: 'EPUB',
    });

    await service.processExport('job-id');

    expect(source.findByIdForUser).toHaveBeenCalledWith('user-id', 'book-id');
    expect(renderer.render).toHaveBeenCalledWith(
      containing({ title: 'La obra', chapters: [] }),
    );
    expect(storage.putBuffer).toHaveBeenCalledWith(
      'exports/project-id/job-id.epub',
      Buffer.from('epub'),
      'application/epub+zip',
      expect.stringContaining('la-obra.epub'),
    );
    expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
      containing({
        where: { id: 'job-id' },
        data: containing({
          status: ExportStatus.COMPLETED,
          progress: 100,
          storageKey: 'exports/project-id/job-id.epub',
        }),
      }),
    );
  });

  it('provides downloads only after a completed export exists', async () => {
    const completed = {
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      format: ExportFormat.EPUB,
      status: ExportStatus.COMPLETED,
      progress: 100,
      errorMessage: null,
      storageKey: 'exports/project-id/job-id.epub',
      fileSizeBytes: 123n,
      createdAt: new Date(),
      completedAt: new Date(),
    };
    prisma.exportJob.findFirst.mockResolvedValue(completed);
    prisma.book.findUnique.mockResolvedValue({ title: 'L’été — À nous' });
    storage.generatePresignedGetUrl.mockResolvedValue(
      'https://download.example/book.epub',
    );

    await expect(
      service.getExportStatus('user-id', 'project-id', 'book-id', 'job-id'),
    ).resolves.toMatchObject({
      id: 'job-id',
      status: ExportStatus.COMPLETED,
      downloadUrl: 'https://download.example/book.epub',
    });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      completed.storageKey,
      {
        responseContentType: 'application/epub+zip',
        downloadName: 'l-ete-a-nous.epub',
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
      { format: ExportFormat.PDF, scopeId: 'book-id' },
      'Unsupported export format: PDF',
    ],
    [
      { format: ExportFormat.EPUB, scopeId: null },
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
      format: ExportFormat.EPUB,
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
      format: ExportFormat.EPUB,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    source.findByIdForUser.mockResolvedValue({
      ...sourceMeta,
      id: 'book-id',
      title: 'Book',
      chapters: [
        {
          id: 'chapter-1',
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
      buffer: Buffer.from('epub'),
      contentType: 'application/epub+zip',
      extension: 'EPUB',
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
        ...sourceMeta,
        id: 'book-id',
        title: 'Book',
        chapters: [
          {
            id: 'chapter-1',
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
  describe('cover and author', () => {
    const queuedJob = {
      id: 'job-id',
      projectId: 'project-id',
      scopeId: 'book-id',
      userId: 'user-id',
      format: ExportFormat.EPUB,
      status: ExportStatus.QUEUED,
    };

    beforeEach(() => {
      prisma.exportJob.findUnique.mockResolvedValue(queuedJob);
      prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.exportJob.update.mockResolvedValue({});
      renderer.render.mockResolvedValue({
        buffer: Buffer.from('epub'),
        contentType: 'application/epub+zip',
        extension: 'EPUB',
      });
    });

    function mockSource(overrides: {
      coverStorageKey?: string | null;
      displayName?: string | null;
      name?: string;
      lastname?: string;
    }): void {
      source.findByIdForUser.mockResolvedValue({
        id: 'book-id',
        title: 'La obra',
        chapters: [],
        coverStorageKey: overrides.coverStorageKey ?? null,
        project: {
          user: {
            name: overrides.name ?? 'Ana',
            lastname: overrides.lastname ?? 'Pérez',
            displayName: overrides.displayName ?? null,
          },
        },
      });
    }

    it('loads the book cover and uses the display name as author', async () => {
      mockSource({
        coverStorageKey: 'books/book-id/cover-1.png',
        displayName: 'A. P. Escritora',
      });
      storage.getBuffer.mockResolvedValue(Buffer.from('png'));

      await service.processExport('job-id');

      expect(storage.getBuffer).toHaveBeenCalledWith(
        'books/book-id/cover-1.png',
      );
      expect(renderer.render).toHaveBeenCalledWith(
        containing({
          author: 'A. P. Escritora',
          cover: {
            buffer: Buffer.from('png'),
            mimeType: 'image/png',
            extension: 'png',
          },
        }),
      );
    });

    it('falls back to name and lastname, then to PlumIA', async () => {
      mockSource({});
      await service.processExport('job-id');
      expect(renderer.render).toHaveBeenLastCalledWith(
        containing({ author: 'Ana Pérez', cover: null }),
      );

      mockSource({ name: ' ', lastname: '' });
      await service.processExport('job-id');
      expect(renderer.render).toHaveBeenLastCalledWith(
        containing({ author: 'PlumIA' }),
      );
    });

    it('exports without cover when the cover cannot be loaded', async () => {
      mockSource({ coverStorageKey: 'books/book-id/cover-1.jpg' });
      storage.getBuffer.mockRejectedValue(new Error('NoSuchKey'));

      await service.processExport('job-id');

      expect(renderer.render).toHaveBeenCalledWith(containing({ cover: null }));
      expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
        containing({
          data: containing({ status: ExportStatus.COMPLETED }),
        }),
      );
    });

    it('ignores a cover key that does not belong to the book', async () => {
      mockSource({ coverStorageKey: 'books/other-book/cover-1.jpg' });

      await service.processExport('job-id');

      expect(storage.getBuffer).not.toHaveBeenCalled();
      expect(renderer.render).toHaveBeenCalledWith(containing({ cover: null }));
    });
  });
});
