import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import { ExportService } from '../export.service';
import { EXPORT_QUEUE_NAME } from '../adapters/bullmq-export-queue.adapter';
import type { ExportQueueJobData } from '../export-queue.port';

@Injectable()
export class ExportWorkersService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ExportQueueJobData> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly exportService: ExportService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('APP_ROLE', 'all') === 'web') return;

    this.worker = new Worker<ExportQueueJobData>(
      EXPORT_QUEUE_NAME,
      async (job: Job<ExportQueueJobData>) =>
        this.exportService.processExport(job.data.exportJobId),
      {
        connection: {
          url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        },
        concurrency: Number(this.config.get<string>('EXPORT_CONCURRENCY', '1')),
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
