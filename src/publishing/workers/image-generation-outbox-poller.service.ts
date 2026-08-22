import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OutboxPoller,
  type PendingOutboxEvent,
} from '../../common/workers/outbox-poller';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IMAGE_GENERATION_QUEUE,
  type ImageGenerationQueue,
} from '../ports/image-generation-queue.port';

const IMAGE_GENERATION_EVENT = 'image.generation.requested';

@Injectable()
export class ImageGenerationOutboxPoller extends OutboxPoller {
  constructor(
    config: ConfigService,
    prisma: PrismaService,
    @Inject(IMAGE_GENERATION_QUEUE)
    private readonly queue: ImageGenerationQueue,
  ) {
    super(config, prisma, IMAGE_GENERATION_EVENT);
  }

  protected async processEvent(event: PendingOutboxEvent): Promise<void> {
    try {
      await this.queue.enqueueGeneration(event.aggregateId);
      await this.markProcessed(event.id);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('already exists')
      ) {
        await this.markProcessed(event.id);
      }
    }
  }
}
