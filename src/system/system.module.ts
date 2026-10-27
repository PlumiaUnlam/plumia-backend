import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { UserModule } from '../user/user.module';
import { EntityExtractionClient } from './entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from './entity-extraction/entity-extraction-pipeline.service';
import { CrossChunkAuditService } from './entity-extraction/cross-chunk-audit.service';
import { EntityResolutionService } from './entity-extraction/entity-resolution.service';
import { ProjectKnowledgeReviewController } from './project-knowledge-review.controller';
import { ProjectKnowledgeReviewService } from './project-knowledge-review.service';
import { KnowledgeProposalAutomationService } from './knowledge-proposal-automation.service';
import { HealthController } from './health.controller';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [PrismaModule, AuditModule, KnowledgeModule, UserModule],
  controllers: [
    SystemController,
    HealthController,
    ProjectKnowledgeReviewController,
  ],
  providers: [
    SystemService,
    EntityExtractionClient,
    EntityExtractionPipelineService,
    CrossChunkAuditService,
    EntityResolutionService,
    ProjectKnowledgeReviewService,
    KnowledgeProposalAutomationService,
  ],
  exports: [SystemService],
})
export class SystemModule {}
