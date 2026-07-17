import { Prisma } from '@prisma/client';
import { type PrismaService } from '../../prisma/prisma.service';
import { createContentHash } from '../domain/json-content';
import type {
  SceneContentUpdateResult,
  SceneVersionContentUpdateResult,
  SceneVersionRecord,
  UpdateSceneContentData,
} from '../ports/scene-repository.port';
import { translatePrismaConflict } from './prisma-error';
import {
  type SceneVersionRow,
  toSceneRecord,
  toSceneVersionRecord,
} from './scene-record.mapper';

export class PrismaSceneVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

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

    return versions.map((version) => toSceneVersionRecord(version));
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
    const versionHash = content
      ? createContentHash(content)
      : scene.contentHash;

    const versionContentSql =
      versionContent === null
        ? Prisma.sql`NULL`
        : Prisma.sql`${JSON.stringify(versionContent)}::jsonb`;
    const [version] = await this.prisma.$queryRaw<SceneVersionRow[]>(Prisma.sql`
      INSERT INTO scene_version (
        scene_id,
        label,
        content,
        content_hash,
        word_count
      )
      VALUES (
        ${sceneId}::uuid,
        ${label ?? null},
        ${versionContentSql},
        ${versionHash},
        ${wordCount ?? scene.wordCount}
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

    return version ? toSceneVersionRecord(version) : null;
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

    return version ? toSceneVersionRecord(version) : null;
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
            version: toSceneVersionRecord(existing),
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
          version: toSceneVersionRecord(version),
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

    return version ? toSceneVersionRecord(version) : null;
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

    return version ? toSceneVersionRecord(version) : null;
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

        await tx.outbox.create({
          data: {
            aggregateType: 'Scene',
            aggregateId: scene.id,
            eventType: 'scene.content.updated',
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
          scene: toSceneRecord(scene),
          contentChanged: true,
        };
      });
    } catch (error: unknown) {
      return translatePrismaConflict(error);
    }
  }
}
