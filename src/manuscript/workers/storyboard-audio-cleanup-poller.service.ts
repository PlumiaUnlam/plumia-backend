import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OutboxPoller,
  type PendingOutboxEvent,
} from '../../common/workers/outbox-poller';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { STORYBOARD_AUDIO_CLEANUP_EVENT } from '../ports/storyboard-card-repository.port';

interface AudioCleanupPayload {
  storageKey?: unknown;
}

@Injectable()
export class StoryboardAudioCleanupPoller extends OutboxPoller {
  private readonly logger = new Logger(StoryboardAudioCleanupPoller.name);

  constructor(
    config: ConfigService,
    prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {
    super(config, prisma, STORYBOARD_AUDIO_CLEANUP_EVENT);
  }

  protected async processEvent(event: PendingOutboxEvent): Promise<void> {
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
}
