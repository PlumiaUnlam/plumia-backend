import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ApplicationHelpChunkInput,
  ApplicationHelpSearchInput,
  ApplicationHelpSearchResult,
  ApplicationHelpStore,
  StaleApplicationHelpChunk,
} from '../ports/application-help-store.port';

interface RankedHelpRow extends ApplicationHelpSearchResult {
  rank: number;
}

const RRF_CONSTANT = 60;

@Injectable()
export class PgApplicationHelpStore implements ApplicationHelpStore {
  constructor(private readonly prisma: PrismaService) {}

  async syncSnapshot(chunks: ApplicationHelpChunkInput[]): Promise<void> {
    if (chunks.length === 0) {
      throw new Error('Refusing to sync an empty application help snapshot');
    }
    const snapshot = JSON.stringify(chunks);
    const ids = JSON.stringify(chunks.map((chunk) => chunk.id));

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "application_help_chunk" (
          "id", "doc_id", "title", "breadcrumb", "area", "route",
          "related", "questions", "keywords", "content", "embed_text",
          "words", "sources", "updated", "content_hash", "created_at", "updated_at"
        )
        SELECT
          item."id", item."doc_id", item."title", item."breadcrumb", item."area", item."route",
          item."related", item."questions", item."keywords", item."content", item."embed_text",
          item."words", item."sources", item."updated", item."content_hash", now(), now()
        FROM jsonb_to_recordset(${snapshot}::jsonb) AS item(
          "id" text, "doc_id" text, "title" text, "breadcrumb" text, "area" text,
          "route" text, "related" text[], "questions" text[], "keywords" text[],
          "content" text, "embed_text" text, "words" integer, "sources" text[],
          "updated" text, "content_hash" text
        )
        ON CONFLICT ("id") DO UPDATE SET
          "doc_id" = EXCLUDED."doc_id",
          "title" = EXCLUDED."title",
          "breadcrumb" = EXCLUDED."breadcrumb",
          "area" = EXCLUDED."area",
          "route" = EXCLUDED."route",
          "related" = EXCLUDED."related",
          "questions" = EXCLUDED."questions",
          "keywords" = EXCLUDED."keywords",
          "content" = EXCLUDED."content",
          "embed_text" = EXCLUDED."embed_text",
          "words" = EXCLUDED."words",
          "sources" = EXCLUDED."sources",
          "updated" = EXCLUDED."updated",
          "content_hash" = EXCLUDED."content_hash",
          "updated_at" = now()
      `;
      await tx.$executeRaw`
        DELETE FROM "application_help_chunk" AS stored
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${ids}::jsonb) AS snapshot("id")
          WHERE snapshot."id" = stored."id"
        )
      `;
    });
  }

  findStaleChunks(
    profile: string,
    limit: number,
  ): Promise<StaleApplicationHelpChunk[]> {
    return this.prisma.$queryRaw<StaleApplicationHelpChunk[]>`
      SELECT "id", "title", "embed_text" AS "embedText", "content_hash" AS "contentHash"
      FROM "application_help_chunk"
      WHERE "embedding" IS NULL
        OR "embedding_content_hash" IS DISTINCT FROM "content_hash"
        OR "embedding_profile" IS DISTINCT FROM ${profile}
      ORDER BY "id"
      LIMIT ${limit}
    `;
  }

  async updateEmbedding(input: {
    id: string;
    embedding: number[];
    contentHash: string;
    profile: string;
  }): Promise<boolean> {
    validateEmbedding(input.embedding);
    const vector = toVectorLiteral(input.embedding);
    const updated = await this.prisma.$executeRaw`
      UPDATE "application_help_chunk"
      SET "embedding" = ${vector}::vector,
          "embedding_content_hash" = ${input.contentHash},
          "embedding_profile" = ${input.profile},
          "updated_at" = now()
      WHERE "id" = ${input.id}
        AND "content_hash" = ${input.contentHash}
    `;
    return updated > 0;
  }

  async search(
    input: ApplicationHelpSearchInput,
  ): Promise<ApplicationHelpSearchResult[]> {
    const lexicalRows = await this.prisma.$queryRaw<RankedHelpRow[]>`
      WITH query AS (
        SELECT websearch_to_tsquery('spanish', ${input.query}) AS value
      )
      SELECT
        doc."id", doc."title", doc."breadcrumb", doc."area", doc."route",
        doc."related", doc."content",
        ts_rank_cd(doc."search_vector", query.value) AS "rank"
      FROM "application_help_chunk" AS doc, query
      WHERE doc."search_vector" @@ query.value
      ORDER BY "rank" DESC, doc."id"
      LIMIT ${input.limit}
    `;

    const scores = new Map<
      string,
      { result: ApplicationHelpSearchResult; score: number }
    >();
    addRankedResults(scores, lexicalRows);

    if (input.embedding) {
      validateEmbedding(input.embedding);
      const vector = toVectorLiteral(input.embedding);
      const semanticRows = await this.prisma.$queryRaw<RankedHelpRow[]>`
        SELECT
          doc."id", doc."title", doc."breadcrumb", doc."area", doc."route",
          doc."related", doc."content",
          (1 - (doc."embedding" <=> ${vector}::vector)) AS "rank"
        FROM "application_help_chunk" AS doc
        WHERE doc."embedding" IS NOT NULL
          AND doc."embedding_content_hash" = doc."content_hash"
          AND doc."embedding_profile" = ${input.profile}
          AND (doc."embedding" <=> ${vector}::vector) <= 0.55
        ORDER BY doc."embedding" <=> ${vector}::vector
        LIMIT ${input.limit}
      `;
      addRankedResults(scores, semanticRows);
    }

    return [...scores.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit)
      .map(({ result, score }) => ({ ...result, score }));
  }
}

function addRankedResults(
  scores: Map<string, { result: ApplicationHelpSearchResult; score: number }>,
  rows: RankedHelpRow[],
): void {
  rows.forEach((row, index) => {
    const result: ApplicationHelpSearchResult = {
      id: row.id,
      title: row.title,
      breadcrumb: row.breadcrumb,
      area: row.area,
      route: row.route,
      related: row.related,
      content: row.content,
    };
    const existing = scores.get(result.id);
    const score = (existing?.score ?? 0) + 1 / (RRF_CONSTANT + index + 1);
    scores.set(result.id, { result, score });
  });
}

function validateEmbedding(embedding: number[]): void {
  if (
    embedding.length !== 1_536 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Invalid application help embedding');
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
