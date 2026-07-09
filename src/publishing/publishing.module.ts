import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';
import { PollinationsAdapter } from './adapters/pollinations.adapter';
import { IMAGE_GENERATION } from './ports/image-generation.port';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PublishingController],
  providers: [
    PublishingService,
    { provide: IMAGE_GENERATION, useClass: PollinationsAdapter },
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
