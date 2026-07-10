import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type {
  SummaryQueue,
  SummaryQueueJobData,
} from '../ports/summary-queue.port';

export const SUMMARY_GENERATION_QUEUE = 'summary-generation';
export const SUMMARY_INVALIDATION_QUEUE = 'summary-invalidation';

@Injectable()
export class BullmqSummaryQueue implements SummaryQueue, OnModuleDestroy {
  private readonly generation: Queue<SummaryQueueJobData>;
  private readonly invalidation: Queue<{ sceneId: string; chapterId: string }>;

  constructor(config: ConfigService) {
    const connection = {
      url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    };
    this.generation = new Queue(SUMMARY_GENERATION_QUEUE, { connection });
    this.invalidation = new Queue(SUMMARY_INVALIDATION_QUEUE, { connection });
  }

  async enqueueGeneration(
    data: SummaryQueueJobData,
    priority: number,
  ): Promise<void> {
    await this.generation.add('generate', data, {
      jobId: data.summaryJobId,
      priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async enqueueInvalidation(sceneId: string, chapterId: string): Promise<void> {
    await this.invalidation.add(
      'invalidate',
      { sceneId, chapterId },
      {
        jobId: `invalidate-${sceneId}`,
        priority: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.generation.close(), this.invalidation.close()]);
  }
}
