import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue, Worker } from 'bullmq';
import type { Logger } from '@nestjs/common';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { EntityExtractionClient } from '../../../src/system/entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from '../../../src/system/entity-extraction/entity-extraction-pipeline.service';
import { SystemService } from '../../../src/system/system.service';

jest.mock('bullmq', () => {
  const add = jest.fn();
  const close = jest.fn();
  const on = jest.fn();

  return {
    Queue: jest.fn().mockImplementation(() => ({
      add,
      close,
    })),
    Worker: jest.fn().mockImplementation(() => ({
      on,
      close,
    })),
  };
});

interface MockPrismaService {
  outbox: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
}

interface WorkerJob {
  data?: {
    outboxId?: string;
  };
}

describe('SystemService', () => {
  let service: SystemService;
  let prisma: MockPrismaService;
  let config: { get: jest.Mock };
  let extractionClient: { hasExtractionModel: jest.Mock };
  let pipeline: { processOutboxEvent: jest.Mock };
  let queueInstance: { add: jest.Mock; close: jest.Mock };
  let workerInstance: { on: jest.Mock; close: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest
      .spyOn(global, 'setInterval')
      .mockReturnValue(1 as unknown as NodeJS.Timeout);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              switch (key) {
                case 'APP_ROLE':
                  return 'all';
                case 'REDIS_URL':
                  return 'redis://localhost:6379';
                case 'ENTITY_EXTRACTION_POLL_MS':
                  return '5000';
                default:
                  return defaultValue;
              }
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            outbox: {
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: EntityExtractionClient,
          useValue: {
            hasExtractionModel: jest.fn(),
          },
        },
        {
          provide: EntityExtractionPipelineService,
          useValue: {
            processOutboxEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SystemService);
    prisma = module.get<MockPrismaService>(PrismaService);
    config = module.get(ConfigService);
    extractionClient = module.get(EntityExtractionClient);
    pipeline = module.get(EntityExtractionPipelineService);
    queueInstance = (Queue as jest.Mock).mock.results[0]?.value as {
      add: jest.Mock;
      close: jest.Mock;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not start workers when running as web only', async () => {
    config.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'APP_ROLE') {
        return 'web';
      }
      return defaultValue;
    });
    extractionClient.hasExtractionModel.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemService,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: EntityExtractionClient, useValue: extractionClient },
        { provide: EntityExtractionPipelineService, useValue: pipeline },
      ],
    }).compile();
    const webOnlyService = module.get(SystemService);

    await webOnlyService.start();

    expect(Worker).not.toHaveBeenCalled();
    expect(prisma.outbox.findMany).not.toHaveBeenCalled();
  });

  it('warns and skips worker startup when extraction model is missing', async () => {
    extractionClient.hasExtractionModel.mockReturnValue(false);
    const logger = Reflect.get(service, 'logger') as Logger;
    const warnSpy = jest.spyOn(logger, 'warn');

    await service.start();

    expect(warnSpy).toHaveBeenCalledWith(
      'Entity extraction worker disabled: ENTITY_EXTRACTION_API_KEY or ENTITY_EXTRACTION_MODEL is missing',
    );
    expect(Worker).not.toHaveBeenCalled();
  });

  it('enqueues pending outbox rows and marks them processed', async () => {
    extractionClient.hasExtractionModel.mockReturnValue(true);
    prisma.outbox.findMany.mockResolvedValue([
      { id: 'outbox-1', createdAt: new Date('2026-07-18T10:00:00.000Z') },
    ]);
    prisma.outbox.update.mockResolvedValue({});

    await service.start();

    expect(Worker).toHaveBeenCalledTimes(1);
    expect(prisma.outbox.findMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        aggregateType: 'Scene',
        eventType: 'scene_changed',
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });
    expect(queueInstance.add).toHaveBeenCalledWith(
      'process-scene-changed',
      { outboxId: 'outbox-1' },
      {
        jobId: 'outbox-1',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: expect.any(Date) as unknown },
    });
  });

  it('marks duplicate jobs as processed without logging an error', async () => {
    extractionClient.hasExtractionModel.mockReturnValue(true);
    prisma.outbox.findMany.mockResolvedValue([
      { id: 'outbox-2', createdAt: new Date('2026-07-18T10:00:00.000Z') },
    ]);
    prisma.outbox.update.mockResolvedValue({});
    queueInstance.add.mockRejectedValueOnce(new Error('Job already exists'));
    const logger = Reflect.get(service, 'logger') as Logger;
    const errorSpy = jest.spyOn(logger, 'error');

    await service.start();

    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-2' },
      data: { processedAt: expect.any(Date) as unknown },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('forwards worker jobs to the extraction pipeline', async () => {
    extractionClient.hasExtractionModel.mockReturnValue(true);
    prisma.outbox.findMany.mockResolvedValue([]);

    await service.start();

    workerInstance = (Worker as jest.Mock).mock.results[0]?.value as {
      on: jest.Mock;
      close: jest.Mock;
    };
    const workerCalls = (Worker as jest.Mock).mock.calls as Array<
      [string, (job: WorkerJob) => Promise<void>]
    >;
    const processor = workerCalls[0]?.[1];

    await processor({ data: { outboxId: 'outbox-3' } });
    await processor({ data: {} });

    expect(pipeline.processOutboxEvent).toHaveBeenCalledTimes(1);
    expect(pipeline.processOutboxEvent).toHaveBeenCalledWith('outbox-3');
    expect(workerInstance.on).toHaveBeenCalledWith(
      'failed',
      expect.any(Function) as unknown,
    );
  });

  it('closes worker and queue on stop', async () => {
    extractionClient.hasExtractionModel.mockReturnValue(true);
    prisma.outbox.findMany.mockResolvedValue([]);

    await service.start();

    workerInstance = (Worker as jest.Mock).mock.results[0]?.value as {
      on: jest.Mock;
      close: jest.Mock;
    };

    await service.stop();

    expect(workerInstance.close).toHaveBeenCalled();
    expect(queueInstance.close).toHaveBeenCalled();
    expect(clearInterval).toHaveBeenCalled();
  });
});
