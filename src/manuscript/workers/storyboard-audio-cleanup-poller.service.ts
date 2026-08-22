import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { STORYBOARD_AUDIO_CLEANUP_EVENT } from '../ports/storyboard-card-repository.port';

interface AudioCleanupPayload {
  storageKey?: unknown;
}

@Injectable()
export class StoryboardAudioCleanupPoller
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StoryboardAudioCleanupPoller.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
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
        where: {
          processedAt: null,
          eventType: STORYBOARD_AUDIO_CLEANUP_EVENT,
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error: unknown) {
      this.logger.error(
        'No se pudo procesar la cola de limpieza de audios.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  private async processEvent(event: {
    id: string;
    payload: unknown;
  }): Promise<void> {
    const payload = event.payload as AudioCleanupPayload;
    if (typeof payload.storageKey !== 'string' || !payload.storageKey) {
      await this.markProcessed(event.id);
      return;
    }

    const activeReference = await this.prisma.storyboardNote.findFirst({
      where: {
        deletedAt: null,
        audioStorageKey: payload.storageKey,
      },
      select: { id: true },
    });

    if (activeReference) {
      await this.markProcessed(event.id);
      return;
    }

    try {
      await this.storageService.deleteObject(payload.storageKey);
      await this.markProcessed(event.id);
    } catch (error: unknown) {
      this.logger.warn(
        `La limpieza del audio ${payload.storageKey} falló; se reintentará.`,
      );
      if (error instanceof Error) {
        this.logger.debug(error.stack ?? error.message);
      }
    }
  }

  private async markProcessed(eventId: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: eventId },
      data: { processedAt: new Date() },
    });
  }
}
