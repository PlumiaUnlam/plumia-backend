import { Module } from '@nestjs/common';
import { BullmqSummaryQueue } from './adapters/bullmq-summary-queue.adapter';
import { GeminiSummaryGenerationAdapter } from './adapters/gemini-summary-generation.adapter';
import { PrismaSummaryRepository } from './adapters/prisma-summary-repository.adapter';
import { SummaryController } from './controllers/summary.controller';
import { SUMMARY_GENERATION_PROVIDER } from './ports/summary-generation-provider.port';
import { SUMMARY_QUEUE } from './ports/summary-queue.port';
import { SUMMARY_REPOSITORY } from './ports/summary-repository.port';
import { SummaryService } from './summary.service';
import { SummaryOutboxPoller } from './workers/summary-outbox-poller.service';
import { SummaryWorkersService } from './workers/summary-workers.service';

@Module({
  controllers: [SummaryController],
  providers: [
    SummaryService,
    SummaryWorkersService,
    SummaryOutboxPoller,
    { provide: SUMMARY_REPOSITORY, useClass: PrismaSummaryRepository },
    {
      provide: SUMMARY_GENERATION_PROVIDER,
      useClass: GeminiSummaryGenerationAdapter,
    },
    { provide: SUMMARY_QUEUE, useClass: BullmqSummaryQueue },
  ],
  exports: [SummaryService],
})
export class SummaryModule {}
