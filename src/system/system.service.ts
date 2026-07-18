import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EntityExtractionClient } from './entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from './entity-extraction/entity-extraction-pipeline.service';

const OUTBOX_BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 5000;
const ENTITY_EXTRACTION_QUEUE = 'entity-extraction';

type AppRole = 'web' | 'worker' | 'all';

interface EntityExtractionJobData {
  outboxId: string;
}

@Injectable()
export class SystemService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemService.name);
  private readonly role: AppRole;
  private readonly connection: { url: string };
  private readonly queue: Queue<EntityExtractionJobData>;
  private worker: Worker<EntityExtractionJobData> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly pipeline: EntityExtractionPipelineService,
  ) {
    this.role =
      (this.config.get<string>('APP_ROLE', 'all') as AppRole) ?? 'all';
    const redisUrl = this.config.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    this.connection = { url: redisUrl };
    this.queue = new Queue<EntityExtractionJobData>(ENTITY_EXTRACTION_QUEUE, {
      connection: this.connection,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.started || this.role === 'web') {
      return;
    }

    if (!this.extractionClient.hasExtractionModel()) {
      this.logger.warn(
        'Entity extraction worker disabled: ENTITY_EXTRACTION_API_KEY or ENTITY_EXTRACTION_MODEL is missing',
      );
      this.started = true;
      return;
    }

    this.started = true;
    this.worker = new Worker<EntityExtractionJobData>(
      ENTITY_EXTRACTION_QUEUE,
      async (job) => {
        const outboxId = job.data?.outboxId;
        if (!outboxId) {
          return;
        }
        await this.pipeline.processOutboxEvent(outboxId);
      },
      {
        connection: this.connection,
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Entity extraction job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      );
    });

    await this.pollOnce();
    this.pollTimer = setInterval(
      () => {
        void this.pollOnce();
      },
      Number(
        this.config.get<string>(
          'ENTITY_EXTRACTION_POLL_MS',
          `${POLL_INTERVAL_MS}`,
        ),
      ),
    );
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }

  private async pollOnce(): Promise<void> {
    const outboxRows = await this.prisma.outbox.findMany({
      where: {
        processedAt: null,
        aggregateType: 'Scene',
        eventType: 'scene_changed',
      },
      orderBy: { createdAt: 'asc' },
      take: OUTBOX_BATCH_SIZE,
    });

    for (const row of outboxRows) {
      try {
        await this.queue.add(
          'process-scene-changed',
          { outboxId: row.id },
          {
            jobId: row.id,
            removeOnComplete: true,
            removeOnFail: false,
          },
        );

        await this.prisma.outbox.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('already exists')) {
          await this.prisma.outbox.update({
            where: { id: row.id },
            data: { processedAt: new Date() },
          });
          continue;
        }

        this.logger.error(`Failed to enqueue outbox ${row.id}: ${message}`);
      }
    }
  }
}
