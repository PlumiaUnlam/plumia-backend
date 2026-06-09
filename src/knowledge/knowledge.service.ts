import { Inject, Injectable } from '@nestjs/common';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import type {
  EntitySearch,
  EntitySearchResult,
} from './ports/entity-search.port';

// Contexto Knowledge Base: Entity, EntityState, Fact, Relationship, EntityProposal.
// La busqueda fuzzy se delega al port EntitySearch (no a pg_trgm). El resto del
// CRUD se implementa en fases posteriores.
@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(ENTITY_SEARCH) private readonly entitySearch: EntitySearch,
  ) {}

  searchEntities(
    projectId: string,
    query: string,
    limit = 10,
  ): Promise<EntitySearchResult[]> {
    return this.entitySearch.searchByName({ projectId, query, limit });
  }
}
