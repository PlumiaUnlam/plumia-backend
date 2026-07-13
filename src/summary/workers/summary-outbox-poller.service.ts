import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SUMMARY_QUEUE, type SummaryQueue } from '../ports/summary-queue.port';

@Injectable()
export class SummaryOutboxPoller implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(SUMMARY_QUEUE) private readonly queue: SummaryQueue,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('APP_ROLE', 'all') === 'worker') {
      return;
    }
    this.timer = setInterval(() => void this.poll(), 1000);
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const events = await this.prisma.outbox.findMany({
        where: { processedAt: null, eventType: 'scene.content.updated' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const event of events) {
        const payload = event.payload as {
          sceneId?: unknown;
          chapterId?: unknown;
        };
        if (
          typeof payload.sceneId === 'string' &&
          typeof payload.chapterId === 'string'
        ) {
          await this.queue.enqueueInvalidation(
            payload.sceneId,
            payload.chapterId,
          );
        }
        await this.prisma.outbox.update({
          where: { id: event.id },
          data: { processedAt: new Date() },
        });
      }
    } finally {
      this.running = false;
    }
  }
}
