import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';

@Module({
  imports: [StorageModule],
  controllers: [ReadingController],
  providers: [ReadingService],
  exports: [ReadingService],
})
export class ReadingModule {}
