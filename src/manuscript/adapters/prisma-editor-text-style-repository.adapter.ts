import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EditorTextStyleNameConflictError } from '../domain/editor-text-style-name-conflict.error';
import {
  type EditorTextStyleRecord,
  type EditorTextStyleRepository,
  type SaveEditorTextStyleData,
} from '../ports/editor-text-style-repository.port';

const RETURNING_STYLE = Prisma.sql`
  RETURNING
    "id",
    "project_id" AS "projectId",
    "name",
    "kind",
    "definition",
    "is_active" AS "isActive",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt"
`;

@Injectable()
export class PrismaEditorTextStyleRepository implements EditorTextStyleRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByProject(projectId: string): Promise<EditorTextStyleRecord[]> {
    return this.prisma.$queryRaw<EditorTextStyleRecord[]>(Prisma.sql`
      SELECT
        "id",
        "project_id" AS "projectId",
        "name",
        "kind",
        "definition",
        "is_active" AS "isActive",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "editor_text_style"
      WHERE "project_id" = ${projectId}::uuid
      ORDER BY "kind" ASC, "name" ASC
    `);
  }

  async create(
    projectId: string,
    data: SaveEditorTextStyleData,
  ): Promise<EditorTextStyleRecord> {
    try {
      const [style] = await this.prisma.$queryRaw<EditorTextStyleRecord[]>(
        Prisma.sql`
          INSERT INTO "editor_text_style" (
            "id", "project_id", "name", "kind", "definition", "updated_at"
          ) VALUES (
            COALESCE(${data.id ?? null}::uuid, gen_random_uuid()),
            ${projectId}::uuid,
            ${data.name},
            ${data.kind},
            ${JSON.stringify(data.definition)}::jsonb,
            CURRENT_TIMESTAMP
          )
          ${RETURNING_STYLE}
        `,
      );
      if (!style) {
        throw new Error('No se pudo crear el estilo');
      }
      return style;
    } catch (error) {
      this.throwOnUniqueConflict(error);
      throw error;
    }
  }

  async update(
    projectId: string,
    styleId: string,
    data: SaveEditorTextStyleData,
  ): Promise<EditorTextStyleRecord | null> {
    try {
      const rows = await this.prisma.$queryRaw<EditorTextStyleRecord[]>(
        Prisma.sql`
          UPDATE "editor_text_style"
          SET
            "name" = ${data.name},
            "kind" = ${data.kind},
            "definition" = ${JSON.stringify(data.definition)}::jsonb,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${styleId}::uuid
            AND "project_id" = ${projectId}::uuid
            AND "is_active" = true
          ${RETURNING_STYLE}
        `,
      );
      return rows[0] ?? null;
    } catch (error) {
      this.throwOnUniqueConflict(error);
      throw error;
    }
  }

  async deactivate(projectId: string, styleId: string): Promise<boolean> {
    const deleted = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "editor_text_style"
      SET
        "is_active" = false,
        "name" = 'archived-' || "id"::text,
        "deleted_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${styleId}::uuid
        AND "project_id" = ${projectId}::uuid
        AND "is_active" = true
    `);
    return deleted > 0;
  }

  private throwOnUniqueConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' ||
        (error.code === 'P2010' && error.meta?.['code'] === '23505'))
    ) {
      throw new EditorTextStyleNameConflictError();
    }
  }
}
