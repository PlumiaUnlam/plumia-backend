import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';
import { PollinationsAdapter } from './adapters/pollinations.adapter';
import { IMAGE_GENERATION } from './ports/image-generation.port';
import { IMAGE_GENERATION_QUEUE } from './ports/image-generation-queue.port';
import { BullmqImageGenerationQueue } from './adapters/bullmq-image-generation-queue.adapter';
import { ImageGenerationOutboxPoller } from './workers/image-generation-outbox-poller.service';
import { ImageGenerationWorkersService } from './workers/image-generation-workers.service';
import { ImageGenerationEventsService } from './workers/image-generation-events.service';
import { ImageAssetsService } from './image-assets.service';
import { ExportController } from './exports/export.controller';
import { ExportService } from './exports/export.service';
import { EXPORT_QUEUE } from './exports/export-queue.port';
import { EXPORT_SOURCE } from './exports/export-source.port';
import { BullmqExportQueue } from './exports/adapters/bullmq-export-queue.adapter';
import { PrismaExportSourceAdapter } from './exports/adapters/prisma-export-source.adapter';
import { ExportRendererService } from './exports/export-renderer.service';
import { DocxExportRenderer } from './exports/renderers/docx-export.renderer';
import { PdfExportRenderer } from './exports/renderers/pdf-export.renderer';
import { EpubExportRenderer } from './exports/renderers/epub-export.renderer';
import { ExportOutboxPoller } from './exports/workers/export-outbox-poller.service';
import { ExportWorkersService } from './exports/workers/export-workers.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PublishingController, ExportController],
  providers: [
    PublishingService,
    ImageAssetsService,
    ExportService,
    ExportRendererService,
    DocxExportRenderer,
    PdfExportRenderer,
    EpubExportRenderer,
    ExportOutboxPoller,
    ExportWorkersService,
    { provide: IMAGE_GENERATION, useClass: PollinationsAdapter },
    ImageGenerationOutboxPoller,
    ImageGenerationWorkersService,
    ImageGenerationEventsService,
    {
      provide: IMAGE_GENERATION_QUEUE,
      useClass: BullmqImageGenerationQueue,
    },
    {
      provide: EXPORT_QUEUE,
      useClass: BullmqExportQueue,
    },
    {
      provide: EXPORT_SOURCE,
      useClass: PrismaExportSourceAdapter,
    },
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
