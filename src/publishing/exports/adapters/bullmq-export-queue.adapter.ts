import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ExportQueue, ExportQueueJobData } from '../export-queue.port';

export const EXPORT_QUEUE_NAME = 'export-generation';

@Injectable()
export class BullmqExportQueue implements ExportQueue, OnModuleDestroy {
  private readonly queue: Queue<ExportQueueJobData>;

  constructor(config: ConfigService) {
    this.queue = new Queue(EXPORT_QUEUE_NAME, {
      connection: {
        url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      },
    });
  }

  async enqueueExport(exportJobId: string): Promise<void> {
    await this.queue.add(
      'export',
      { exportJobId },
      {
        jobId: exportJobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
