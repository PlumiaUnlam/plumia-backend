import { ExportFormat, ExportStatus } from '@prisma/client';
import { ExportService } from '../../../src/publishing/exports/export.service';

describe('ExportService', () => {
  const prisma = {
    project: { findFirst: jest.fn() },
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

  const service = new ExportService(
    prisma as never,
    storage as never,
    renderer as never,
    source as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a project export job and its outbox event', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-id' });
    const job = {
      id: 'job-id',
      projectId: 'project-id',
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
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );

    const result = await service.requestExport('user-id', 'project-id', 'PDF');

    expect(result).toMatchObject({
      id: 'job-id',
      projectId: 'project-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    expect(prisma.exportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-id',
          userId: 'user-id',
          format: ExportFormat.PDF,
          scopeType: 'PROJECT',
        }),
      }),
    );
    expect(prisma.outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aggregateType: 'ExportJob',
          aggregateId: 'job-id',
          eventType: 'export.requested',
        }),
      }),
    );
  });

  it('does not expose a job that belongs to another project or user', async () => {
    prisma.exportJob.findFirst.mockResolvedValue(null);

    await expect(
      service.getExportStatus('other-user', 'project-id', 'job-id'),
    ).rejects.toThrow('Export job not found');
  });

  it('renders, stores and completes a queued export', async () => {
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-id',
      projectId: 'project-id',
      userId: 'user-id',
      format: ExportFormat.PDF,
      status: ExportStatus.QUEUED,
    });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.exportJob.update.mockResolvedValue({});
    source.findByIdForUser.mockResolvedValue({
      id: 'project-id',
      title: 'La obra',
      books: [],
    });
    renderer.render.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
      extension: 'PDF',
    });

    await service.processExport('job-id');

    expect(renderer.render).toHaveBeenCalledWith(
      ExportFormat.PDF,
      expect.objectContaining({ title: 'La obra', books: [] }),
    );
    expect(storage.putBuffer).toHaveBeenCalledWith(
      'exports/project-id/job-id.pdf',
      Buffer.from('pdf'),
      'application/pdf',
      expect.stringContaining('la-obra.pdf'),
    );
    expect(prisma.exportJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'job-id' },
        data: expect.objectContaining({
          status: ExportStatus.COMPLETED,
          progress: 100,
          storageKey: 'exports/project-id/job-id.pdf',
        }),
      }),
    );
  });
});
