import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntitySearch,
  EntitySearchInput,
  EntitySearchResult,
} from '../ports/entity-search.port';

// Adapter Postgres del port EntitySearch: UNICO lugar que conoce pg_trgm
// (funcion `similarity()` + indice GIN `idx_entity_name`). Swappable por
// Meilisearch/Typesense/etc. sin tocar servicios ni entidades.
@Injectable()
export class PgEntitySearch implements EntitySearch {
  constructor(private readonly prisma: PrismaService) {}

  searchByName(input: EntitySearchInput): Promise<EntitySearchResult[]> {
    const threshold = input.threshold ?? 0.3;
    return this.prisma.$queryRaw<EntitySearchResult[]>`
      SELECT
        "id" AS "entityId",
        "canonical_name" AS "canonicalName",
        similarity("canonical_name", ${input.query}) AS "score"
      FROM "entity"
      WHERE "project_id" = ${input.projectId}::uuid
        AND "is_active" = true
        AND "deleted_at" IS NULL
        AND similarity("canonical_name", ${input.query}) > ${threshold}
      ORDER BY "score" DESC
      LIMIT ${input.limit}
    `;
  }
}
