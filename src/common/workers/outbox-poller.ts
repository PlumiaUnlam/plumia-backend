import { Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';

export interface PendingOutboxEvent {
  id: string;
  aggregateId: string;
  payload: unknown;
}

export abstract class OutboxPoller implements OnModuleInit, OnModuleDestroy {
  private readonly outboxLogger = new Logger(OutboxPoller.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  protected constructor(
    protected readonly config: ConfigService,
    protected readonly prisma: PrismaService,
    private readonly eventType: string,
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
      this.timer = null;
    }
  }

  protected abstract processEvent(event: PendingOutboxEvent): Promise<void>;

  protected async markProcessed(eventId: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: eventId },
      data: { processedAt: new Date() },
    });
  }

  private async poll(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const events = await this.prisma.outbox.findMany({
        where: {
          processedAt: null,
          eventType: this.eventType,
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error: unknown) {
      this.outboxLogger.error(
        `No se pudo procesar la cola ${this.eventType}.`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
