interface CapturedWorker {
  queue: string;
  processor: (job: { data: unknown }) => Promise<unknown>;
  options: unknown;
  close: jest.Mock;
}

const mockWorkers: CapturedWorker[] = [];

jest.mock('bullmq', () => ({
  Worker: class {
    readonly close = jest.fn().mockResolvedValue(undefined);
    constructor(
      readonly queue: string,
      readonly processor: (job: { data: unknown }) => Promise<unknown>,
      readonly options: unknown,
    ) {
      mockWorkers.push(this);
    }
  },
}));

import { type ConfigService } from '@nestjs/config';
import { SummaryWorkersService } from '../../../src/summary/workers/summary-workers.service';
import {
  SUMMARY_GENERATION_QUEUE,
  SUMMARY_INVALIDATION_QUEUE,
} from '../../../src/summary/adapters/bullmq-summary-queue.adapter';
import { ImageGenerationWorkersService } from '../../../src/publishing/workers/image-generation-workers.service';
import { IMAGE_GENERATION_QUEUE_NAME } from '../../../src/publishing/adapters/bullmq-image-generation-queue.adapter';
import { ExportWorkersService } from '../../../src/publishing/exports/workers/export-workers.service';
import { EXPORT_QUEUE_NAME } from '../../../src/publishing/exports/adapters/bullmq-export-queue.adapter';

function config(
  values: Record<string, string | undefined> = {},
): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('queue workers', () => {
  beforeEach(() => {
    mockWorkers.length = 0;
  });

  it('does not create workers in the web role and closes empty worker groups safely', async () => {
    const summary = new SummaryWorkersService(
      config({ APP_ROLE: 'web' }),
      {} as never,
    );
    const image = new ImageGenerationWorkersService(
      config({ APP_ROLE: 'web' }),
      {} as never,
    );
    const exportWorker = new ExportWorkersService(
      config({ APP_ROLE: 'web' }),
      {} as never,
    );

    summary.onModuleInit();
    image.onModuleInit();
    exportWorker.onModuleInit();
    expect(mockWorkers).toHaveLength(0);
    await summary.onModuleDestroy();
    await image.onModuleDestroy();
    await exportWorker.onModuleDestroy();
  });

  it('runs generation and invalidation jobs through the two summary workers', async () => {
    const summaryService = {
      processGeneration: jest.fn().mockResolvedValue(undefined),
      processInvalidation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SummaryWorkersService(
      config({ REDIS_URL: 'redis://queue:6379' }),
      summaryService as never,
    );
    service.onModuleInit();

    expect(mockWorkers.map((worker) => worker.queue)).toEqual([
      SUMMARY_GENERATION_QUEUE,
      SUMMARY_INVALIDATION_QUEUE,
    ]);
    expect(mockWorkers[0]?.options).toMatchObject({
      connection: { url: 'redis://queue:6379' },
      concurrency: 2,
    });
    await mockWorkers[0]!.processor({
      data: {
        summaryJobId: 'job-1',
        scope: 'scene',
        scopeId: 'scene-1',
        force: true,
      },
    });
    await mockWorkers[1]!.processor({
      data: { sceneId: 'scene-1', chapterId: 'chapter-1' },
    });
    expect(summaryService.processGeneration).toHaveBeenCalledWith(
      'job-1',
      'scene',
      'scene-1',
      true,
    );
    expect(summaryService.processInvalidation).toHaveBeenCalledWith(
      'scene-1',
      'chapter-1',
    );

    await service.onModuleDestroy();
    expect(mockWorkers.map((worker) => worker.close)).toEqual([
      expect.any(Function),
      expect.any(Function),
    ]);
    expect(
      mockWorkers.every((worker) => worker.close.mock.calls.length === 1),
    ).toBe(true);
  });

  it('runs image generation jobs and applies configured concurrency', async () => {
    const publishingService = {
      processImageGeneration: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ImageGenerationWorkersService(
      config({
        REDIS_URL: 'redis://images:6379',
        IMAGE_GENERATION_CONCURRENCY: '5',
      }),
      publishingService as never,
    );
    service.onModuleInit();

    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0]?.queue).toBe(IMAGE_GENERATION_QUEUE_NAME);
    expect(mockWorkers[0]?.options).toMatchObject({
      connection: { url: 'redis://images:6379' },
      concurrency: 5,
    });
    await mockWorkers[0]!.processor({
      data: { imageGenerationJobId: 'image-job-1' },
    });
    expect(publishingService.processImageGeneration).toHaveBeenCalledWith(
      'image-job-1',
    );
    await service.onModuleDestroy();
    expect(mockWorkers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('runs export jobs and uses the default Redis connection and concurrency', async () => {
    const exportService = {
      processExport: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ExportWorkersService(config(), exportService as never);
    service.onModuleInit();

    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0]?.queue).toBe(EXPORT_QUEUE_NAME);
    expect(mockWorkers[0]?.options).toMatchObject({
      connection: { url: 'redis://localhost:6379' },
      concurrency: 1,
    });
    await mockWorkers[0]!.processor({ data: { exportJobId: 'export-1' } });
    expect(exportService.processExport).toHaveBeenCalledWith('export-1');
    await service.onModuleDestroy();
    expect(mockWorkers[0]?.close).toHaveBeenCalledTimes(1);
  });
});
