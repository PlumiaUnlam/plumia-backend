import { Module } from '@nestjs/common';
import { PgEntitySearch } from './adapters/pg-entity-search.adapter';
import { PrismaEntityRepository } from './adapters/prisma-entity-repository.adapter';
import { PrismaRelationshipRepository } from './adapters/prisma-relationship-repository.adapter';
import { PrismaTimelineEventRepository } from './adapters/prisma-timeline-event-repository.adapter';
import { EntitiesController } from './controllers/entities.controller';
import { EntityProposalsController } from './controllers/entity-proposals.controller';
import { RelationshipsController } from './controllers/relationships.controller';
import { TimelineController } from './controllers/timeline.controller';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { EntityProposalService } from './services/entity-proposal.service';
import { ENTITY_REPOSITORY } from './ports/entity-repository.port';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import { RELATIONSHIP_REPOSITORY } from './ports/relationship-repository.port';
import { TIMELINE_EVENT_REPOSITORY } from './ports/timeline-event-repository.port';

@Module({
  controllers: [
    KnowledgeController,
    EntitiesController,
    EntityProposalsController,
    RelationshipsController,
    TimelineController,
  ],
  providers: [
    KnowledgeService,
    EntityProposalService,
    { provide: ENTITY_SEARCH, useClass: PgEntitySearch },
    { provide: ENTITY_REPOSITORY, useClass: PrismaEntityRepository },
    {
      provide: RELATIONSHIP_REPOSITORY,
      useClass: PrismaRelationshipRepository,
    },
    {
      provide: TIMELINE_EVENT_REPOSITORY,
      useClass: PrismaTimelineEventRepository,
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
