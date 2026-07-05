import { Module } from '@nestjs/common';
import { PgEntitySearch } from './adapters/pg-entity-search.adapter';
import { PrismaEntityRepository } from './adapters/prisma-entity-repository.adapter';
import { PrismaRelationshipRepository } from './adapters/prisma-relationship-repository.adapter';
import { EntitiesController } from './controllers/entities.controller';
import { RelationshipsController } from './controllers/relationships.controller';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ENTITY_REPOSITORY } from './ports/entity-repository.port';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import { RELATIONSHIP_REPOSITORY } from './ports/relationship-repository.port';

@Module({
  controllers: [
    KnowledgeController,
    EntitiesController,
    RelationshipsController,
  ],
  providers: [
    KnowledgeService,
    { provide: ENTITY_SEARCH, useClass: PgEntitySearch },
    { provide: ENTITY_REPOSITORY, useClass: PrismaEntityRepository },
    {
      provide: RELATIONSHIP_REPOSITORY,
      useClass: PrismaRelationshipRepository,
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
