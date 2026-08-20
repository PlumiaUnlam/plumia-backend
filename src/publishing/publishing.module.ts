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

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PublishingController],
  providers: [
    PublishingService,
    ImageAssetsService,
    { provide: IMAGE_GENERATION, useClass: PollinationsAdapter },
    ImageGenerationOutboxPoller,
    ImageGenerationWorkersService,
    ImageGenerationEventsService,
    {
      provide: IMAGE_GENERATION_QUEUE,
      useClass: BullmqImageGenerationQueue,
    },
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
