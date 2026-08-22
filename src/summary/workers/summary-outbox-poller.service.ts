import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OutboxPoller,
  type PendingOutboxEvent,
} from '../../common/workers/outbox-poller';
import { PrismaService } from '../../prisma/prisma.service';
import { SUMMARY_QUEUE, type SummaryQueue } from '../ports/summary-queue.port';

@Injectable()
export class SummaryOutboxPoller extends OutboxPoller {
  constructor(
    config: ConfigService,
    prisma: PrismaService,
    @Inject(SUMMARY_QUEUE) private readonly queue: SummaryQueue,
  ) {
    super(config, prisma, 'scene.content.updated');
  }

  protected async processEvent(event: PendingOutboxEvent): Promise<void> {
    const payload = event.payload as {
      sceneId?: unknown;
      chapterId?: unknown;
    };
    if (
      typeof payload.sceneId === 'string' &&
      typeof payload.chapterId === 'string'
    ) {
      await this.queue.enqueueInvalidation(payload.sceneId, payload.chapterId);
    }
    await this.markProcessed(event.id);
  }
}
