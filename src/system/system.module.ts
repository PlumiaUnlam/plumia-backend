import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EntityExtractionClient } from './entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from './entity-extraction/entity-extraction-pipeline.service';
import { EntityResolutionService } from './entity-extraction/entity-resolution.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [PrismaModule],
  controllers: [SystemController],
  providers: [
    SystemService,
    EntityExtractionClient,
    EntityExtractionPipelineService,
    EntityResolutionService,
  ],
  exports: [SystemService],
})
export class SystemModule {}
