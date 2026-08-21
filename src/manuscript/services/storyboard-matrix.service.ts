import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMatrixNoteDto } from '../dto/storyboard-matrix/create-matrix-note.dto';
import { CreateStoryboardArcDto } from '../dto/storyboard-matrix/create-storyboard-arc.dto';
import { UpdateMatrixNoteDto } from '../dto/storyboard-matrix/update-matrix-note.dto';

interface MatrixNoteRecord {
  id: string;
  arcId: string;
  chapterId: string;
  content: string;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MatrixArcRecord {
  id: string;
  projectId: string;
  title: string;
  sourceType: string;
  customType: string | null;
  entityId: string | null;
  relationshipId: string | null;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
  notes: MatrixNoteRecord[];
}

@Injectable()
export class StoryboardMatrixService {
  constructor(private readonly prisma: PrismaService) {}

  async listArcs(
    userId: string,
    projectId: string,
  ): Promise<MatrixArcRecord[]> {
    await this.assertProject(userId, projectId);

    const arcs = await this.prisma.$queryRaw<Omit<MatrixArcRecord, 'notes'>[]>`
      SELECT
        id,
        project_id AS "projectId",
        title,
        source_type AS "sourceType",
        custom_type AS "customType",
        entity_id AS "entityId",
        relationship_id AS "relationshipId",
        sort_key AS "sortKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM storyboard_arc
      WHERE project_id = ${projectId}::uuid
        AND deleted_at IS NULL
      ORDER BY sort_key ASC, created_at ASC
    `;

    const notes =
      arcs.length > 0
        ? await this.prisma.$queryRaw<MatrixNoteRecord[]>`
            SELECT
              id,
              arc_id AS "arcId",
              chapter_id AS "chapterId",
              content,
              sort_key AS "sortKey",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM storyboard_matrix_note
            WHERE arc_id IN (${Prisma.join(arcs.map((arc) => Prisma.sql`${arc.id}::uuid`))})
              AND deleted_at IS NULL
            ORDER BY sort_key ASC, created_at ASC
          `
        : [];

    const notesByArcId = notes.reduce(
      (acc, note) => {
        acc[note.arcId] = [...(acc[note.arcId] ?? []), note];
        return acc;
      },
      {} as Record<string, MatrixNoteRecord[]>,
    );

    return arcs.map((arc) => ({
      ...arc,
      notes: notesByArcId[arc.id] ?? [],
    }));
  }

  async createArc(
    userId: string,
    projectId: string,
    dto: CreateStoryboardArcDto,
  ): Promise<MatrixArcRecord> {
    await this.assertProject(userId, projectId);
    await this.assertArcSource(projectId, dto);

    const sortKey = await this.nextArcSortKey(projectId);
    const entityId = dto.entityId
      ? Prisma.sql`${dto.entityId}::uuid`
      : Prisma.sql`NULL`;
    const relationshipId = dto.relationshipId
      ? Prisma.sql`${dto.relationshipId}::uuid`
      : Prisma.sql`NULL`;
    const customType = dto.customType?.trim();
    const normalizedCustomType =
      customType === undefined || customType.length === 0 ? null : customType;
    const [arc] = await this.prisma.$queryRaw<Omit<MatrixArcRecord, 'notes'>[]>`
      INSERT INTO storyboard_arc (
        id,
        project_id,
        title,
        source_type,
        custom_type,
        entity_id,
        relationship_id,
        sort_key,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        ${projectId}::uuid,
        ${dto.title},
        ${dto.sourceType},
        ${normalizedCustomType},
        ${entityId},
        ${relationshipId},
        ${sortKey},
        CURRENT_TIMESTAMP
      )
      RETURNING
        id,
        project_id AS "projectId",
        title,
        source_type AS "sourceType",
        custom_type AS "customType",
        entity_id AS "entityId",
        relationship_id AS "relationshipId",
        sort_key AS "sortKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    if (!arc) {
      throw new NotFoundException('Storyboard arc not found');
    }

    return { ...arc, notes: [] };
  }

  async removeArc(userId: string, arcId: string): Promise<void> {
    const result = await this.prisma.$executeRaw`
      UPDATE storyboard_arc
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ${arcId}::uuid
        AND deleted_at IS NULL
        AND project_id IN (
          SELECT id FROM project WHERE user_id = ${userId}
        )
    `;

    if (result === 0) {
      throw new NotFoundException('Storyboard arc not found');
    }
  }

  async createNote(
    userId: string,
    arcId: string,
    dto: CreateMatrixNoteDto,
  ): Promise<MatrixNoteRecord> {
    const arc = await this.findArcForUser(userId, arcId);
    await this.assertChapter(arc.projectId, dto.chapterId);

    const sortKey = await this.nextNoteSortKey(arc.id, dto.chapterId);
    const [note] = await this.prisma.$queryRaw<MatrixNoteRecord[]>`
      INSERT INTO storyboard_matrix_note (
        id,
        arc_id,
        chapter_id,
        content,
        sort_key,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        ${arc.id}::uuid,
        ${dto.chapterId}::uuid,
        ${dto.content},
        ${sortKey},
        CURRENT_TIMESTAMP
      )
      RETURNING
        id,
        arc_id AS "arcId",
        chapter_id AS "chapterId",
        content,
        sort_key AS "sortKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    if (!note) {
      throw new NotFoundException('Matrix note not found');
    }

    return note;
  }

  async updateNote(
    userId: string,
    noteId: string,
    dto: UpdateMatrixNoteDto,
  ): Promise<MatrixNoteRecord> {
    const [note] = await this.prisma.$queryRaw<MatrixNoteRecord[]>`
      UPDATE storyboard_matrix_note
      SET content = ${dto.content},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${noteId}::uuid
        AND deleted_at IS NULL
        AND arc_id IN (
          SELECT sa.id
          FROM storyboard_arc sa
          INNER JOIN project p ON p.id = sa.project_id
          WHERE p.user_id = ${userId}
        )
      RETURNING
        id,
        arc_id AS "arcId",
        chapter_id AS "chapterId",
        content,
        sort_key AS "sortKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    if (!note) {
      throw new NotFoundException('Matrix note not found');
    }

    return note;
  }

  async removeNote(userId: string, noteId: string): Promise<void> {
    const result = await this.prisma.$executeRaw`
      UPDATE storyboard_matrix_note
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ${noteId}::uuid
        AND deleted_at IS NULL
        AND arc_id IN (
          SELECT sa.id
          FROM storyboard_arc sa
          INNER JOIN project p ON p.id = sa.project_id
          WHERE p.user_id = ${userId}
        )
    `;

    if (result === 0) {
      throw new NotFoundException('Matrix note not found');
    }
  }

  private async assertProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }

  private async assertArcSource(
    projectId: string,
    dto: CreateStoryboardArcDto,
  ): Promise<void> {
    if (dto.sourceType === 'custom') {
      return;
    }

    if (dto.sourceType === 'entity' && dto.entityId) {
      const entity = await this.prisma.entity.findFirst({
        where: { id: dto.entityId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (entity) {
        return;
      }
    }

    if (dto.sourceType === 'relationship' && dto.relationshipId) {
      const relationship = await this.prisma.relationship.findFirst({
        where: { id: dto.relationshipId, projectId },
        select: { id: true },
      });
      if (relationship) {
        return;
      }
    }

    throw new NotFoundException('Arc source not found');
  }

  private async assertChapter(
    projectId: string,
    chapterId: string,
  ): Promise<void> {
    const chapter = await this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        deletedAt: null,
        book: { projectId },
      },
      select: { id: true },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }
  }

  private async findArcForUser(
    userId: string,
    arcId: string,
  ): Promise<Pick<MatrixArcRecord, 'id' | 'projectId'>> {
    const [arc] = await this.prisma.$queryRaw<
      Pick<MatrixArcRecord, 'id' | 'projectId'>[]
    >`
      SELECT sa.id, sa.project_id AS "projectId"
      FROM storyboard_arc sa
      INNER JOIN project p ON p.id = sa.project_id
      WHERE sa.id = ${arcId}::uuid
        AND sa.deleted_at IS NULL
        AND p.user_id = ${userId}
    `;

    if (!arc) {
      throw new NotFoundException('Storyboard arc not found');
    }

    return arc;
  }

  private async nextArcSortKey(projectId: string): Promise<string> {
    const [result] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM storyboard_arc
      WHERE project_id = ${projectId}::uuid
    `;
    const count = result?.count ?? 0n;

    return String(Number(count) + 1).padStart(6, '0');
  }

  private async nextNoteSortKey(
    arcId: string,
    chapterId: string,
  ): Promise<string> {
    const [result] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM storyboard_matrix_note
      WHERE arc_id = ${arcId}::uuid
        AND chapter_id = ${chapterId}::uuid
    `;
    const count = result?.count ?? 0n;

    return String(Number(count) + 1).padStart(6, '0');
  }
}
