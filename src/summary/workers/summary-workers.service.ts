import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import { SUMMARY_SCOPE } from '../domain/summary-scope';
import {
  SUMMARY_GENERATION_QUEUE,
  SUMMARY_INVALIDATION_QUEUE,
} from '../adapters/bullmq-summary-queue.adapter';
import { SummaryService } from '../summary.service';
import type { SummaryQueueJobData } from '../ports/summary-queue.port';

interface InvalidationJobData {
  sceneId: string;
  chapterId: string;
}

@Injectable()
export class SummaryWorkersService implements OnModuleInit, OnModuleDestroy {
  private workers: Worker[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly summaryService: SummaryService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('APP_ROLE', 'all') === 'web') {
      return;
    }
    const connection = {
      url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    };
    this.workers = [
      new Worker<SummaryQueueJobData>(
        SUMMARY_GENERATION_QUEUE,
        async (job: Job<SummaryQueueJobData>) =>
          this.summaryService.processGeneration(
            job.data.summaryJobId,
            job.data.scope,
            job.data.scopeId,
            job.data.force,
          ),
        { connection, concurrency: 2 },
      ),
      new Worker<InvalidationJobData>(
        SUMMARY_INVALIDATION_QUEUE,
        async (job: Job<InvalidationJobData>) =>
          this.summaryService.processInvalidation(
            job.data.sceneId,
            job.data.chapterId,
          ),
        { connection, concurrency: 2 },
      ),
    ];
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
