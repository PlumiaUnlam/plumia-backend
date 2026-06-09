import { Module } from '@nestjs/common';
import { PgEntitySearch } from './adapters/pg-entity-search.adapter';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ENTITY_SEARCH } from './ports/entity-search.port';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    { provide: ENTITY_SEARCH, useClass: PgEntitySearch },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
