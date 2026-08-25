import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChunkEmbeddingUpdateInput,
  ChunkUpsertInput,
  VectorSearchInput,
  VectorSearchResult,
  VectorStore,
} from '../ports/vector-store.port';

// Adapter Postgres del port VectorStore: UNICO lugar que conoce pgvector
// (operador `<=>` y el tipo `vector`). Swappable por Qdrant/Pinecone/etc.
// sin tocar servicios ni entidades.
@Injectable()
export class PgVectorStore implements VectorStore {
  constructor(private readonly prisma: PrismaService) {}

  async upsertChunk(input: ChunkUpsertInput): Promise<void> {
    const embedding = toVectorLiteral(input.embedding);
    await this.prisma.$executeRaw`
      INSERT INTO "chunk" (
        "id", "project_id", "scene_id", "content", "embedding",
        "token_count", "chunk_index", "content_hash", "embedding_content_hash", "embedding_model",
        "created_at", "updated_at"
      )
      VALUES (
        gen_random_uuid(), ${input.projectId}::uuid, ${input.sceneId}::uuid, ${input.content}, ${embedding}::vector,
        ${input.tokenCount}, ${input.chunkIndex}, ${input.contentHash ?? null}, ${input.contentHash ?? null}, ${input.model},
        now(), now()
      )
      ON CONFLICT ("scene_id", "chunk_index") DO UPDATE SET
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "token_count" = EXCLUDED."token_count",
        "content_hash" = EXCLUDED."content_hash",
        "embedding_content_hash" = EXCLUDED."content_hash",
        "embedding_model" = EXCLUDED."embedding_model",
        "updated_at" = now()
    `;
  }

  async updateChunkEmbedding(input: ChunkEmbeddingUpdateInput): Promise<void> {
    const embedding = toVectorLiteral(input.embedding);
    await this.prisma.$executeRaw`
      UPDATE "chunk"
      SET
        "embedding" = ${embedding}::vector,
        "embedding_content_hash" = ${input.contentHash},
        "embedding_model" = ${input.model},
        "updated_at" = now()
      WHERE "id" = ${input.chunkId}::uuid
        AND "content_hash" = ${input.contentHash}
    `;
  }

  search(input: VectorSearchInput): Promise<VectorSearchResult[]> {
    const embedding = toVectorLiteral(input.embedding);
    return this.prisma.$queryRaw<VectorSearchResult[]>`
      SELECT
        "id" AS "chunkId",
        "scene_id" AS "sceneId",
        "content" AS "content",
        ("embedding" <=> ${embedding}::vector) AS "distance"
      FROM "chunk"
      WHERE "project_id" = ${input.projectId}::uuid
        AND "embedding" IS NOT NULL
        AND "embedding_content_hash" = "content_hash"
        AND "embedding_model" = ${input.model}
      ORDER BY "embedding" <=> ${embedding}::vector
      LIMIT ${input.limit}
    `;
  }
}

// pgvector espera el literal '[1,2,3]'. No se puede pasar number[] como
// parametro tipado por Prisma Client, asi que se serializa y castea a ::vector.
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
