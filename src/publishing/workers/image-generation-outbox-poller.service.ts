import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IMAGE_GENERATION_QUEUE,
  type ImageGenerationQueue,
} from '../ports/image-generation-queue.port';

const IMAGE_GENERATION_EVENT = 'image.generation.requested';

@Injectable()
export class ImageGenerationOutboxPoller
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(IMAGE_GENERATION_QUEUE)
    private readonly queue: ImageGenerationQueue,
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

  private async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const events = await this.prisma.outbox.findMany({
        where: { processedAt: null, eventType: IMAGE_GENERATION_EVENT },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const event of events) {
        try {
          await this.queue.enqueueGeneration(event.aggregateId);
          await this.prisma.outbox.update({
            where: { id: event.id },
            data: { processedAt: new Date() },
          });
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            error.message.toLowerCase().includes('already exists')
          ) {
            await this.prisma.outbox.update({
              where: { id: event.id },
              data: { processedAt: new Date() },
            });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
