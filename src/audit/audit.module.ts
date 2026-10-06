import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TemporalConsistencyRuleService } from './temporal-consistency-rule.service';
import { TemporalKnowledgeSnapshotService } from './temporal-knowledge-snapshot.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    TemporalKnowledgeSnapshotService,
    TemporalConsistencyRuleService,
  ],
  exports: [
    AuditService,
    TemporalKnowledgeSnapshotService,
    TemporalConsistencyRuleService,
  ],
})
export class AuditModule {}
