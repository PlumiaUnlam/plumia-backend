import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  StaleChunk,
  StaleChunkStore,
} from '../ports/stale-chunk-store.port';

@Injectable()
export class PrismaStaleChunkStore implements StaleChunkStore {
  constructor(private readonly prisma: PrismaService) {}

  findStaleChunks(
    projectId: string,
    model: string,
    limit: number,
  ): Promise<StaleChunk[]> {
    return this.prisma.$queryRaw<StaleChunk[]>`
      SELECT
        "id",
        "content",
        "content_hash" AS "contentHash"
      FROM "chunk"
      WHERE "project_id" = ${projectId}::uuid
        AND "content_hash" IS NOT NULL
        AND (
          "embedding" IS NULL
          OR "embedding_content_hash" IS DISTINCT FROM "content_hash"
          OR "embedding_model" IS DISTINCT FROM ${model}
        )
      ORDER BY "updated_at" DESC
      LIMIT ${limit}
    `;
  }
}
