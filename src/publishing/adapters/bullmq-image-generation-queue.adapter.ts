import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type {
  ImageGenerationQueue,
  ImageGenerationQueueJobData,
} from '../ports/image-generation-queue.port';

export const IMAGE_GENERATION_QUEUE_NAME = 'image-generation';

@Injectable()
export class BullmqImageGenerationQueue
  implements ImageGenerationQueue, OnModuleDestroy
{
  private readonly queue: Queue<ImageGenerationQueueJobData>;

  constructor(config: ConfigService) {
    const connection = {
      url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    };
    this.queue = new Queue(IMAGE_GENERATION_QUEUE_NAME, { connection });
  }

  async enqueueGeneration(jobId: string): Promise<void> {
    await this.queue.add(
      'generate',
      { imageGenerationJobId: jobId },
      {
        jobId,
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
