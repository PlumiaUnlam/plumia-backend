import { AuditStatus, ExportFormat } from '@prisma/client';
import type { AuthenticatedRequest } from '../../../src/manuscript/controllers/authenticated-request';
import { AnalyticsController } from '../../../src/analytics/analytics.controller';
import { WritingGoalType } from '../../../src/analytics/domain/writing-goal-type';
import { AuditController } from '../../../src/audit/audit.controller';
import { PublishingController } from '../../../src/publishing/publishing.controller';
import { ExportController } from '../../../src/publishing/exports/export.controller';
import { ExportSettingsController } from '../../../src/publishing/exports/export-settings.controller';
import { SummaryController } from '../../../src/summary/controllers/summary.controller';

const req = { user: { id: 'user-1' } } as AuthenticatedRequest;
const now = new Date('2026-09-01T00:00:00.000Z');

describe('analytics and audit controllers', () => {
  it('passes dashboard timezone and goal parameters to analytics', async () => {
    const service = {
      getDashboard: jest.fn().mockResolvedValue({ totalWords: 250 }),
      upsertGoal: jest.fn().mockResolvedValue({ targetWords: 500 }),
    };
    const controller = new AnalyticsController(service as never);
    const dto = { targetWords: 500 };

    await expect(
      controller.getDashboard(req, 'project-1', 120),
    ).resolves.toEqual({ totalWords: 250 });
    await expect(
      controller.upsertGoal(req, 'project-1', WritingGoalType.DAILY, dto),
    ).resolves.toEqual({ targetWords: 500 });
    expect(service.getDashboard).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      120,
    );
    expect(service.upsertGoal).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      WritingGoalType.DAILY,
      dto,
    );
  });

  it('forwards audit status filters and updates alerts using the authenticated user', async () => {
    const service = {
      listByProject: jest.fn().mockResolvedValue([{ id: 'alert-1' }]),
      updateStatus: jest
        .fn()
        .mockResolvedValue({ id: 'alert-1', status: AuditStatus.RESOLVED }),
    };
    const controller = new AuditController(service as never);

    await expect(controller.list(req, 'project-1')).resolves.toEqual([
      { id: 'alert-1' },
    ]);
    await controller.list(req, 'project-1', AuditStatus.DISMISSED);
    await expect(
      controller.update(req, 'alert-1', { status: AuditStatus.RESOLVED }),
    ).resolves.toMatchObject({ status: AuditStatus.RESOLVED });
    expect(service.listByProject).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'project-1',
      undefined,
    );
    expect(service.listByProject).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'project-1',
      AuditStatus.DISMISSED,
    );
    expect(service.updateStatus).toHaveBeenCalledWith(
      'user-1',
      'alert-1',
      AuditStatus.RESOLVED,
    );
  });
});

describe('summary controller', () => {
  it('supports scene and chapter summary retrieval and generation', async () => {
    const summary = {
      id: 'summary-1',
      scopeType: 'scene',
      scopeId: 'scene-1',
      title: 'Scene',
      content: 'A scene summary',
      source: 'ai_generated',
      isDirty: false,
      provider: 'gemini',
      model: 'flash',
      tokenCount: 20,
      createdAt: now,
      updatedAt: now,
    };
    const job = {
      id: 'job-1',
      scopeType: 'scene',
      scopeId: 'scene-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      completedAt: null,
    };
    const service = {
      getSummary: jest.fn().mockResolvedValue(summary),
      requestGeneration: jest.fn().mockResolvedValue(job),
      getJob: jest.fn().mockResolvedValue(job),
      updateManual: jest
        .fn()
        .mockResolvedValue({ ...summary, source: 'author_manual' }),
    };
    const controller = new SummaryController(service as never);

    await expect(
      controller.getSceneSummary(req, 'scene-1'),
    ).resolves.toMatchObject({ id: 'summary-1', content: 'A scene summary' });
    await expect(
      controller.generateSceneSummary(req, 'scene-1'),
    ).resolves.toMatchObject({ id: 'job-1' });
    await expect(
      controller.getChapterSummary(req, 'chapter-1'),
    ).resolves.toMatchObject({ id: 'summary-1' });
    await expect(
      controller.generateChapterSummary(req, 'chapter-1'),
    ).resolves.toMatchObject({ id: 'job-1' });
    await expect(controller.getJob(req, 'job-1')).resolves.toMatchObject({
      status: 'QUEUED',
    });
    await expect(
      controller.updateSummary(req, 'summary-1', { content: 'Author edit' }),
    ).resolves.toMatchObject({ source: 'author_manual' });
    expect(service.getSummary).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'scene',
      'scene-1',
    );
    expect(service.requestGeneration).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'scene',
      'scene-1',
    );
    expect(service.getSummary).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'chapter',
      'chapter-1',
    );
    expect(service.requestGeneration).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'chapter',
      'chapter-1',
    );
    expect(service.getJob).toHaveBeenCalledWith('user-1', 'job-1');
    expect(service.updateManual).toHaveBeenCalledWith(
      'user-1',
      'summary-1',
      'Author edit',
    );
  });
});

describe('publishing and export controllers', () => {
  it('routes image generation, queries, events, preview, attachment and deletion', async () => {
    const job = {
      id: 'job-1',
      entityId: 'entity-1',
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      generatedImage: null,
    };
    const image = {
      id: 'image-1',
      entityId: 'entity-1',
      prompt: 'Mara',
      imageUrl: 'https://img/1',
      imageType: 'image/png',
      isPrimary: true,
      createdAt: now,
    };
    const publishing = {
      requestImageGeneration: jest.fn().mockResolvedValue(job),
      getImageGenerationJob: jest.fn().mockResolvedValue(job),
      listPrimaryImages: jest.fn().mockResolvedValue([image]),
      generatePreviewImage: jest.fn().mockResolvedValue({
        imageUrl: 'url',
        storageKey: 'key',
        prompt: 'p',
        imageType: 'image/png',
      }),
      attachImage: jest.fn().mockResolvedValue(image),
      listImages: jest.fn().mockResolvedValue([image]),
      setPrimaryImage: jest.fn().mockResolvedValue(image),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    const imageEvents = { streamForUser: jest.fn().mockReturnValue('stream') };
    const controller = new PublishingController(
      publishing as never,
      imageEvents as never,
    );
    const generateDto = { entityId: 'entity-1', prompt: 'Mara' };
    const attachDto = { entityId: 'entity-1', imageId: 'image-1' };

    await expect(
      controller.generate(req, generateDto as never),
    ).resolves.toMatchObject({ id: 'job-1' });
    await expect(
      controller.getGenerationJob(req, 'job-1'),
    ).resolves.toMatchObject({ id: 'job-1' });
    await expect(controller.listPrimary(req)).resolves.toEqual([image]);
    await controller.listPrimary(req, 'entity-1, entity-2,,');
    expect(publishing.listPrimaryImages).toHaveBeenNthCalledWith(
      1,
      'user-1',
      [],
    );
    expect(publishing.listPrimaryImages).toHaveBeenNthCalledWith(2, 'user-1', [
      'entity-1',
      'entity-2',
    ]);
    expect(controller.events(req)).toBe('stream');
    expect(imageEvents.streamForUser).toHaveBeenCalledWith('user-1');
    await expect(
      controller.generatePreview({ prompt: 'test' } as never),
    ).resolves.toMatchObject({ storageKey: 'key' });
    await expect(controller.attach(req, attachDto as never)).resolves.toEqual(
      image,
    );
    await expect(controller.list(req, 'entity-1')).resolves.toEqual([image]);
    await expect(
      controller.setPrimary(req, 'entity-1', { imageId: 'image-1' }),
    ).resolves.toEqual(image);
    await expect(
      controller.remove(req, 'entity-1', 'image-1'),
    ).resolves.toBeUndefined();
    expect(publishing.requestImageGeneration).toHaveBeenCalledWith(
      'user-1',
      generateDto,
    );
    expect(publishing.getImageGenerationJob).toHaveBeenCalledWith(
      'user-1',
      'job-1',
    );
    expect(publishing.generatePreviewImage).toHaveBeenCalledWith({
      prompt: 'test',
    });
    expect(publishing.attachImage).toHaveBeenCalledWith('user-1', attachDto);
    expect(publishing.setPrimaryImage).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
      'image-1',
    );
    expect(publishing.deleteImage).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
      'image-1',
    );
  });

  it('forwards export creation and status lookup', async () => {
    const exportJob = {
      id: 'export-1',
      projectId: 'project-1',
      bookId: 'book-1',
      format: ExportFormat.PDF,
      status: 'QUEUED',
      progress: 0,
      errorMessage: null,
      createdAt: now,
      completedAt: null,
    };
    const service = {
      requestExport: jest.fn().mockResolvedValue(exportJob),
      getExportStatus: jest.fn().mockResolvedValue(exportJob),
    };
    const controller = new ExportController(service as never);

    await expect(
      controller.create(req, 'project-1', 'book-1', {
        format: ExportFormat.PDF,
      }),
    ).resolves.toMatchObject({ id: 'export-1' });
    await expect(
      controller.getStatus(req, 'project-1', 'book-1', 'export-1'),
    ).resolves.toMatchObject({ id: 'export-1' });
    expect(service.requestExport).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'book-1',
      ExportFormat.PDF,
    );
    expect(service.getExportStatus).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'book-1',
      'export-1',
    );
  });

  it('passes project-scoped export settings reads and writes through', async () => {
    const settings = {
      margins: { top: 20 },
      header: { enabled: true },
      footer: { enabled: false },
    };
    const service = {
      getSettings: jest.fn().mockResolvedValue(settings),
      upsertSettings: jest.fn().mockResolvedValue(settings),
    };
    const controller = new ExportSettingsController(service as never);
    const dto = { margins: { top: 20 } };

    await expect(controller.get(req, 'project-1')).resolves.toEqual(settings);
    await expect(
      controller.update(req, 'project-1', dto as never),
    ).resolves.toEqual(settings);
    expect(service.getSettings).toHaveBeenCalledWith('user-1', 'project-1');
    expect(service.upsertSettings).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      dto,
    );
  });
});
