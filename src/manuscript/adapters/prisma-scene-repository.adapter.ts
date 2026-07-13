import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createContentHash } from '../domain/json-content';
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
import { toSceneRecord } from './scene-record.mapper';
import { PrismaSceneVersionRepository } from './prisma-scene-version.repository';

@Injectable()
export class PrismaSceneRepository implements SceneRepository {
  private readonly versions: PrismaSceneVersionRepository;

  constructor(private readonly prisma: PrismaService) {
    this.versions = new PrismaSceneVersionRepository(prisma);
  }

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
      select: { id: true },
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
      const scene = await this.prisma.scene.create({
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
      return toSceneRecord(scene);
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

    return scene ? toSceneRecord(scene) : null;
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
            scene: toSceneRecord(existing),
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

        await tx.outbox.create({
          data: {
            aggregateType: 'Scene',
            aggregateId: scene.id,
            eventType: 'scene.content.updated',
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
          scene: toSceneRecord(scene),
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
    return this.versions.listVersionsForUser(userId, sceneId);
  }

  async createVersionForUser(
    userId: string,
    sceneId: string,
    label?: string,
    content?: Record<string, unknown>,
    wordCount?: number,
  ): Promise<SceneVersionRecord | null> {
    return this.versions.createVersionForUser(
      userId,
      sceneId,
      label,
      content,
      wordCount,
    );
  }

  async findVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneVersionRecord | null> {
    return this.versions.findVersionForUser(userId, sceneId, versionId);
  }

  async updateVersionContentForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    data: UpdateSceneContentData,
  ): Promise<SceneVersionContentUpdateResult | null> {
    return this.versions.updateVersionContentForUser(
      userId,
      sceneId,
      versionId,
      data,
    );
  }

  async updateVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    data: { label?: string | null },
  ): Promise<SceneVersionRecord | null> {
    return this.versions.updateVersionForUser(userId, sceneId, versionId, data);
  }

  async softDeleteVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
    deletedAt: Date,
  ): Promise<SceneVersionRecord | null> {
    return this.versions.softDeleteVersionForUser(
      userId,
      sceneId,
      versionId,
      deletedAt,
    );
  }

  async restoreVersionForUser(
    userId: string,
    sceneId: string,
    versionId: string,
  ): Promise<SceneContentUpdateResult | null> {
    return this.versions.restoreVersionForUser(userId, sceneId, versionId);
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

    return scene ? toSceneRecord(scene) : null;
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
}
