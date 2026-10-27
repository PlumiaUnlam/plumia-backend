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
const JOB_ATTEMPTS = 4;
const JOB_BACKOFF_MS = 3000;
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
    if (this.started) {
      return;
    }

    if (this.role === 'web') {
      this.started = true;
      this.logger.warn(
        'Entity extraction worker is disabled for APP_ROLE=web; configure a separate worker process.',
      );
      return;
    }

    if (!this.extractionClient.hasExtractionModel()) {
      this.logger.warn(
        'Entity extraction worker disabled: ENTITY_EXTRACTION_MODEL is missing',
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
        `Entity extraction job ${job?.id ?? 'unknown'} failed on attempt ${job?.attemptsMade ?? 0}/${job?.opts.attempts ?? 1}: ${error.message}`,
      );
      if (
        job &&
        job.data?.outboxId &&
        job.attemptsMade >= (job.opts.attempts ?? 1)
      ) {
        void this.pipeline
          .markOutboxEventFailed(job.data.outboxId, error)
          .catch((failure: unknown) => {
            this.logger.error(
              `Could not finalize failed outbox ${job.data.outboxId}: ${failure instanceof Error ? failure.message : String(failure)}`,
            );
          });
      }
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Entity extraction worker error: ${error.message}`);
    });
    this.queue.on('error', (error) => {
      this.logger.error(`Entity extraction queue error: ${error.message}`);
    });

    try {
      await Promise.all([
        this.queue.waitUntilReady(),
        this.worker.waitUntilReady(),
      ]);
      this.logger.log(
        `Entity extraction worker ready (role=${this.role}, model configured).`,
      );
    } catch (error) {
      this.logger.error(
        `Entity extraction worker could not connect to Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    try {
      const outboxRows = await this.prisma.outbox.findMany({
        where: {
          processedAt: null,
          OR: [
            {
              aggregateType: 'Scene',
              eventType: { in: ['scene_changed', 'scene_temporal_audit'] },
            },
            {
              aggregateType: 'Project',
              eventType: 'project_analysis_requested',
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: OUTBOX_BATCH_SIZE,
      });

      await outboxRows.reduce(
        (processing, row) =>
          processing.then(async () => {
            try {
              const existing = await this.queue.getJob(row.id);
              if (existing) {
                const state = await existing.getState();
                if (
                  state === 'failed' &&
                  existing.attemptsMade >= (existing.opts.attempts ?? 1)
                ) {
                  await this.pipeline.markOutboxEventFailed(
                    row.id,
                    new Error(existing.failedReason ?? 'Queue job failed'),
                  );
                }
                return;
              }

              await this.queue.add(
                'process-scene-event',
                { outboxId: row.id },
                {
                  jobId: row.id,
                  attempts: JOB_ATTEMPTS,
                  backoff: { type: 'exponential', delay: JOB_BACKOFF_MS },
                  removeOnComplete: true,
                  removeOnFail: false,
                },
              );
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              if (message.toLowerCase().includes('already exists')) {
                return;
              }
              this.logger.error(
                `Failed to enqueue outbox ${row.id}: ${message}`,
              );
            }
          }),
        Promise.resolve(),
      );
    } catch (error) {
      this.logger.error(
        `Entity extraction outbox poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
