import { Module } from '@nestjs/common';
import { PgEntitySearch } from './adapters/pg-entity-search.adapter';
import { PrismaEntityRepository } from './adapters/prisma-entity-repository.adapter';
import { EntitiesController } from './controllers/entities.controller';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ENTITY_REPOSITORY } from './ports/entity-repository.port';
import { ENTITY_SEARCH } from './ports/entity-search.port';

@Module({
  controllers: [KnowledgeController, EntitiesController],
  providers: [
    KnowledgeService,
    { provide: ENTITY_SEARCH, useClass: PgEntitySearch },
    { provide: ENTITY_REPOSITORY, useClass: PrismaEntityRepository },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
