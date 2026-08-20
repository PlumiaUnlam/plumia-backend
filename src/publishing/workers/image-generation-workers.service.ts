import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import { IMAGE_GENERATION_QUEUE_NAME } from '../adapters/bullmq-image-generation-queue.adapter';
import type { ImageGenerationQueueJobData } from '../ports/image-generation-queue.port';
import { PublishingService } from '../publishing.service';

@Injectable()
export class ImageGenerationWorkersService
  implements OnModuleInit, OnModuleDestroy
{
  private worker: Worker<ImageGenerationQueueJobData> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly publishingService: PublishingService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('APP_ROLE', 'all') === 'web') {
      return;
    }
    const connection = {
      url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    };
    this.worker = new Worker<ImageGenerationQueueJobData>(
      IMAGE_GENERATION_QUEUE_NAME,
      async (job: Job<ImageGenerationQueueJobData>) =>
        this.publishingService.processImageGeneration(
          job.data.imageGenerationJobId,
        ),
      {
        connection,
        concurrency: Number(
          this.config.get<string>('IMAGE_GENERATION_CONCURRENCY', '2'),
        ),
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
