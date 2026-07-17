import { Injectable } from '@nestjs/common';
import { Prisma, type Scene } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createContentHash } from '../domain/json-content';
import { planSceneChunks } from '../domain/scene-chunking';
import { toSceneStatus } from '../domain/scene-status';
import {
  CreateSceneData,
  SceneContentUpdateResult,
  SceneRecord,
  SceneRepository,
  SceneVersionContentUpdateResult,
  SceneVersionRecord,
  UpdateSceneContentData,
  UpdateSceneData,
} from '../ports/scene-repository.port';
import { translatePrismaConflict } from './prisma-error';

interface SceneVersionRow {
  id: string;
  sceneId: string;
  label: string | null;
  content: Prisma.JsonValue | null;
  contentHash: string | null;
  wordCount: number;
  createdFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
  contentHash: string | null;
  tokenCount: number;
  isDirty: boolean;
}

@Injectable()
export class PrismaSceneRepository implements SceneRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(
    userId: string,
    data: CreateSceneData,
  ): Promise<SceneRecord | null> {
    const chapter = await this.prisma.chapter.findFirst({
      where: {
        id: data.chapterId,
        deletedAt: null,
        book: { project: { userId } },
      },
      select: {
        id: true,
        book: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (!chapter) {
      return null;
    }

    const order =
      data.order ??
      ((
        await this.prisma.scene.aggregate({
          where: { chapterId: data.chapterId, deletedAt: null },
          _max: { order: true },
        })
      )._max.order ?? 0) + 1;

    try {
      const scene = await this.prisma.$transaction(async (tx) => {
        const created = await tx.scene.create({
          data: {
            chapterId: data.chapterId,
            sortKey: data.sortKey,
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.content !== undefined
              ? {
                  content: data.content as Prisma.InputJsonValue,
                  contentHash: createContentHash(data.content),
                }
              : {}),
            ...(data.wordCount !== undefined
              ? { wordCount: data.wordCount }
              : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            order,
          },
        });

        if (data.content !== undefined) {
          await this.syncSceneChunks(tx, created.id, chapter.book.projectId, data.content, {
            markDirty: false,
          });
        }

        return created;
      });
      return this.toSceneRecord(scene);
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }
  }

  async findByIdForUser(
    userId: string,
    sceneId: string,
  ): Promise<SceneRecord | null> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
    });

    return scene ? this.toSceneRecord(scene) : null;
  }

  async updateForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneData,
  ): Promise<SceneRecord | null> {
    let result: { count: number };
    try {
      result = await this.prisma.scene.updateMany({
        where: {
          id: sceneId,
          deletedAt: null,
          chapter: { book: { project: { userId } } },
        },
        data: this.toSceneUpdateData(data),
      });
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }

    if (result.count === 0) {
      return null;
    }

    return this.findByIdForUser(userId, sceneId);
  }

  async updateContentForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneContentData,
  ): Promise<SceneContentUpdateResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.scene.findFirst({
          where: {
            id: sceneId,
            deletedAt: null,
            chapter: { book: { project: { userId } } },
          },
        });

        if (!existing) {
          return null;
        }

        const newHash = createContentHash(data.content);

        if (existing.contentHash === newHash) {
          return {
            scene: this.toSceneRecord(existing),
            contentChanged: false,
          };
        }

      const scene = await tx.scene.update({
        where: { id: existing.id },
        data: {
          content: data.content as Prisma.InputJsonValue,
            contentHash: newHash,
            ...(data.wordCount !== undefined
              ? { wordCount: data.wordCount }
              : {}),
          },
        });

        const projectId = await this.getProjectIdForScene(tx, scene.id);
        if (!projectId) {
          return null;
        }

        await this.syncSceneChunks(tx, scene.id, projectId, data.content, {
          markDirty: true,
        });

        await tx.outbox.create({
          data: {
            aggregateType: 'Scene',
            aggregateId: scene.id,
            eventType: 'scene_changed',
            payload: {
              sceneId: scene.id,
              chapterId: scene.chapterId,
              contentHash: newHash,
              wordCount: scene.wordCount,
              userId,
            },
            createdAt: new Date(),
          },
        });

        return {
          scene: this.toSceneRecord(scene),
          contentChanged: true,
        };
      });
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }
  }

  async listVersionsForUser(
    userId: string,
    sceneId: string,
  ): Promise<SceneVersionRecord[] | null> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
      select: { id: true },
    });

    if (!scene) {
      return null;
    }

    const versions = await this.prisma.$queryRaw<SceneVersionRow[]>`
      SELECT
        id::text AS "id",
        scene_id::text AS "sceneId",
        label,
        content,
        content_hash AS "contentHash",
        word_count AS "wordCount",
        created_from_id::text AS "createdFromId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM scene_version
      WHERE scene_id = ${sceneId}::uuid
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;

    return versions.map((version) => this.toSceneVersionRecord(version));
  }

  async createVersionForUser(
    userId: string,
    sceneId: string,
    label?: string,
    content?: Record<string, unknown>,
    wordCount?: number,
  ): Promise<SceneVersionRecord | null> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
    });

    if (!scene) {
      return null;
    }

    const versionContent = content ?? scene.content;
    const versionHash = content ? createContentHash(content) : scene.contentHash;

    const versionContentSql =
      versionContent === null
        ? Prisma.sql`NULL`
        : Prisma.sql`${JSON.stringify(versionContent)}::jsonb`;
    const [version] = await this.prisma.$queryRaw<SceneVersionRow[]>(Prisma.sql`
      INSERT INTO scene_version (
        id,
        scene_id,
        label,
        content,
        content_hash,
        word_count,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        ${sceneId}::uuid,
        ${label ?? null},
        ${versionContentSql},
        ${versionHash},
        ${wordCount ?? scene.wordCount},
        CURRENT_TIMESTAMP
      )
      RETURNING
        id::text AS "id",
        scene_id::text AS "sceneId",
        label,
        content,
        content_hash AS "contentHash",
        word_count AS "wordCount",
        created_from_id::text AS "createdFromId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
    `);

    return version ? this.toSceneVersionRecord(version) : null;
  }

  async findVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneVersionRecord | null> {
    const [version] = await this.prisma.$queryRaw<SceneVersionRow[]>`
      SELECT
        v.id::text AS "id",
        v.scene_id::text AS "sceneId",
        v.label,
        v.content,
        v.content_hash AS "contentHash",
        v.word_count AS "wordCount",
        v.created_from_id::text AS "createdFromId",
        v.created_at AS "createdAt",
        v.updated_at AS "updatedAt",
        v.deleted_at AS "deletedAt"
      FROM scene_version v
      JOIN scene s ON s.id = v.scene_id
      JOIN chapter c ON c.id = s.chapter_id
      JOIN book b ON b.id = c.book_id
      JOIN project p ON p.id = b.project_id
      WHERE v.id = ${versionId}::uuid
        AND v.scene_id = ${sceneId}::uuid
        AND v.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND p.user_id = ${userId}
      LIMIT 1
    `;

    return version ? this.toSceneVersionRecord(version) : null;
  }

  async updateVersionContentForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    data: UpdateSceneContentData,
  ): Promise<SceneVersionContentUpdateResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [existing] = await tx.$queryRaw<SceneVersionRow[]>`
          SELECT
            v.id::text AS "id",
            v.scene_id::text AS "sceneId",
            v.label,
            v.content,
            v.content_hash AS "contentHash",
            v.word_count AS "wordCount",
            v.created_from_id::text AS "createdFromId",
            v.created_at AS "createdAt",
            v.updated_at AS "updatedAt",
            v.deleted_at AS "deletedAt"
          FROM scene_version v
          JOIN scene s ON s.id = v.scene_id
          JOIN chapter c ON c.id = s.chapter_id
          JOIN book b ON b.id = c.book_id
          JOIN project p ON p.id = b.project_id
          WHERE v.id = ${versionId}::uuid
            AND v.scene_id = ${sceneId}::uuid
            AND v.deleted_at IS NULL
            AND s.deleted_at IS NULL
            AND p.user_id = ${userId}
          LIMIT 1
        `;

        if (!existing) {
          return null;
        }

        const newHash = createContentHash(data.content);

        if (existing.contentHash === newHash) {
          return {
            version: this.toSceneVersionRecord(existing),
            contentChanged: false,
          };
        }

        const [version] = await tx.$queryRaw<SceneVersionRow[]>(Prisma.sql`
          UPDATE scene_version
          SET
            content = ${JSON.stringify(data.content)}::jsonb,
            content_hash = ${newHash},
            word_count = ${data.wordCount ?? existing.wordCount},
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${existing.id}::uuid
          RETURNING
            id::text AS "id",
            scene_id::text AS "sceneId",
            label,
            content,
            content_hash AS "contentHash",
            word_count AS "wordCount",
            created_from_id::text AS "createdFromId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            deleted_at AS "deletedAt"
        `);

        if (!version) {
          return null;
        }

        return {
          version: this.toSceneVersionRecord(version),
          contentChanged: true,
        };
      });
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }
  }

  async updateVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    data: { label?: string | null },
  ): Promise<SceneVersionRecord | null> {
    const [version] = await this.prisma.$queryRaw<SceneVersionRow[]>`
      UPDATE scene_version v
      SET
        label = ${data.label ?? null},
        updated_at = CURRENT_TIMESTAMP
      FROM scene s
      JOIN chapter c ON c.id = s.chapter_id
      JOIN book b ON b.id = c.book_id
      JOIN project p ON p.id = b.project_id
      WHERE v.id = ${versionId}::uuid
        AND v.scene_id = ${sceneId}::uuid
        AND s.id = v.scene_id
        AND v.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND p.user_id = ${userId}
      RETURNING
        v.id::text AS "id",
        v.scene_id::text AS "sceneId",
        v.label,
        v.content,
        v.content_hash AS "contentHash",
        v.word_count AS "wordCount",
        v.created_from_id::text AS "createdFromId",
        v.created_at AS "createdAt",
        v.updated_at AS "updatedAt",
        v.deleted_at AS "deletedAt"
    `;

    return version ? this.toSceneVersionRecord(version) : null;
  }

  async softDeleteVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    deletedAt: Date,
  ): Promise<SceneVersionRecord | null> {
    const [version] = await this.prisma.$queryRaw<SceneVersionRow[]>`
      UPDATE scene_version v
      SET
        deleted_at = ${deletedAt},
        updated_at = CURRENT_TIMESTAMP
      FROM scene s
      JOIN chapter c ON c.id = s.chapter_id
      JOIN book b ON b.id = c.book_id
      JOIN project p ON p.id = b.project_id
      WHERE v.id = ${versionId}::uuid
        AND v.scene_id = ${sceneId}::uuid
        AND s.id = v.scene_id
        AND v.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND p.user_id = ${userId}
      RETURNING
        v.id::text AS "id",
        v.scene_id::text AS "sceneId",
        v.label,
        v.content,
        v.content_hash AS "contentHash",
        v.word_count AS "wordCount",
        v.created_from_id::text AS "createdFromId",
        v.created_at AS "createdAt",
        v.updated_at AS "updatedAt",
        v.deleted_at AS "deletedAt"
    `;

    return version ? this.toSceneVersionRecord(version) : null;
  }

  async restoreVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneContentUpdateResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [version] = await tx.$queryRaw<SceneVersionRow[]>`
          SELECT
            v.id::text AS "id",
            v.scene_id::text AS "sceneId",
            v.label,
            v.content,
            v.content_hash AS "contentHash",
            v.word_count AS "wordCount",
            v.created_from_id::text AS "createdFromId",
            v.created_at AS "createdAt",
            v.updated_at AS "updatedAt",
            v.deleted_at AS "deletedAt"
          FROM scene_version v
          JOIN scene s ON s.id = v.scene_id
          JOIN chapter c ON c.id = s.chapter_id
          JOIN book b ON b.id = c.book_id
          JOIN project p ON p.id = b.project_id
          WHERE v.id = ${versionId}::uuid
            AND v.scene_id = ${sceneId}::uuid
            AND v.deleted_at IS NULL
            AND s.deleted_at IS NULL
            AND p.user_id = ${userId}
          LIMIT 1
        `;

        if (!version) {
          return null;
        }

        const scene = await tx.scene.update({
          where: { id: sceneId },
          data: {
            content:
              version.content === null
                ? Prisma.JsonNull
                : (version.content as Prisma.InputJsonValue),
            contentHash: version.contentHash,
            wordCount: version.wordCount,
          },
        });

        const projectId = await this.getProjectIdForScene(tx, sceneId);
        if (!projectId) {
          return null;
        }

        if (version.content !== null) {
          await this.syncSceneChunks(
            tx,
            scene.id,
            projectId,
            version.content as Record<string, unknown>,
            {
              markDirty: true,
            },
          );
        } else {
          await this.syncSceneChunks(tx, scene.id, projectId, null, {
            markDirty: true,
          });
        }

        await tx.outbox.create({
          data: {
            aggregateType: 'Scene',
            aggregateId: scene.id,
            eventType: 'scene_changed',
            payload: {
              sceneId: scene.id,
              chapterId: scene.chapterId,
              contentHash: scene.contentHash,
              wordCount: scene.wordCount,
              userId,
              restoredFromVersionId: version.id,
            },
            createdAt: new Date(),
          },
        });

        return {
          scene: this.toSceneRecord(scene),
          contentChanged: true,
        };
      });
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }
  }

  async softDeleteForUser(
    userId: string,
    sceneId: string,
    deletedAt: Date,
  ): Promise<SceneRecord | null> {
    const result = await this.prisma.scene.updateMany({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
      data: { deletedAt },
    });

    if (result.count === 0) {
      return null;
    }

    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, chapter: { book: { project: { userId } } } },
    });

    return scene ? this.toSceneRecord(scene) : null;
  }

  private toSceneUpdateData(
    data: UpdateSceneData,
  ): Prisma.SceneUpdateManyMutationInput {
    return {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    };
  }

  private toSceneRecord(scene: Scene): SceneRecord {
    return {
      id: scene.id,
      chapterId: scene.chapterId,
      title: scene.title,
      sortKey: scene.sortKey,
      content: scene.content,
      contentHash: scene.contentHash,
      wordCount: scene.wordCount,
      povCharacterId: scene.povCharacterId,
      status: toSceneStatus(scene.status),
      order: scene.order,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
      deletedAt: scene.deletedAt,
    };
  }

  private toSceneVersionRecord(version: SceneVersionRow): SceneVersionRecord {
    return {
      id: version.id,
      sceneId: version.sceneId,
      label: version.label,
      content: version.content,
      contentHash: version.contentHash,
      wordCount: version.wordCount,
      createdFromId: version.createdFromId,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      deletedAt: version.deletedAt,
    };
  }

  private async syncSceneChunks(
    tx: Prisma.TransactionClient,
    sceneId: string,
    projectId: string,
    content: Record<string, unknown> | null,
    options: { markDirty: boolean },
  ): Promise<void> {
    if (content === null) {
      await tx.chunk.deleteMany({ where: { sceneId } });
      return;
    }

    const plans = planSceneChunks(content);
    const existing = await tx.chunk.findMany({
      where: { sceneId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        contentHash: true,
        tokenCount: true,
        isDirty: true,
      },
    });

    const existingByIndex = new Map<number, ChunkRow>(
      existing.map((chunk) => [chunk.chunkIndex, chunk] as const),
    );
    const seenIndices = new Set<number>();

    for (const plan of plans) {
      seenIndices.add(plan.chunkIndex);
      const current = existingByIndex.get(plan.chunkIndex);

      if (!current) {
        await tx.chunk.create({
          data: {
            projectId,
            sceneId,
            content: plan.content,
            tokenCount: plan.tokenCount,
            chunkIndex: plan.chunkIndex,
            contentHash: plan.contentHash,
            isDirty: options.markDirty,
          },
        });
        continue;
      }

      const hasChanged =
        current.contentHash !== plan.contentHash || current.content !== plan.content;
      if (hasChanged) {
        await tx.chunk.update({
          where: { id: current.id },
          data: {
            content: plan.content,
            tokenCount: plan.tokenCount,
            contentHash: plan.contentHash,
            isDirty: options.markDirty,
          },
        });
      }
    }

    const staleChunkIds = existing
      .filter((chunk) => !seenIndices.has(chunk.chunkIndex))
      .map((chunk) => chunk.id);

    if (staleChunkIds.length > 0) {
      await tx.chunk.deleteMany({
        where: { id: { in: staleChunkIds } },
      });
    }
  }

  private async getProjectIdForScene(
    tx: Prisma.TransactionClient,
    sceneId: string,
  ): Promise<string | null> {
    const scene = await tx.scene.findFirst({
      where: { id: sceneId },
      select: {
        chapter: {
          select: {
            book: {
              select: {
                projectId: true,
              },
            },
          },
        },
      },
    });

    return scene?.chapter.book.projectId ?? null;
  }

}
