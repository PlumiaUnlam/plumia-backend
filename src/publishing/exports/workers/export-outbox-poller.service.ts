import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OutboxPoller,
  type PendingOutboxEvent,
} from '../../../common/workers/outbox-poller';
import { PrismaService } from '../../../prisma/prisma.service';
import { EXPORT_QUEUE, type ExportQueue } from '../export-queue.port';

@Injectable()
export class ExportOutboxPoller extends OutboxPoller {
  constructor(
    config: ConfigService,
    prisma: PrismaService,
    @Inject(EXPORT_QUEUE) private readonly queue: ExportQueue,
  ) {
    super(config, prisma, 'export.requested');
  }

  protected async processEvent(event: PendingOutboxEvent): Promise<void> {
    try {
      await this.queue.enqueueExport(event.aggregateId);
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
