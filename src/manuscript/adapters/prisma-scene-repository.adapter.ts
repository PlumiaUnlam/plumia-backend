import { Injectable } from '@nestjs/common';
import { Prisma, type Scene } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createContentHash } from '../domain/json-content';
import { toSceneStatus } from '../domain/scene-status';
import {
  CreateSceneData,
  SceneRecord,
  SceneRepository,
  UpdateSceneContentData,
  UpdateSceneData,
} from '../ports/scene-repository.port';
import { translatePrismaConflict } from './prisma-error';

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
  ): Promise<SceneRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contentHash = createContentHash(data.content);
        const result = await tx.scene.updateMany({
          where: {
            id: sceneId,
            deletedAt: null,
            chapter: { book: { project: { userId } } },
          },
          data: {
            content: data.content as Prisma.InputJsonValue,
            contentHash,
            ...(data.wordCount !== undefined
              ? { wordCount: data.wordCount }
              : {}),
          },
        });

        if (result.count === 0) {
          return null;
        }

        const scene = await tx.scene.findFirst({
          where: {
            id: sceneId,
            deletedAt: null,
            chapter: { book: { project: { userId } } },
          },
        });

        if (!scene) {
          return null;
        }

        await tx.outbox.create({
          data: {
            aggregateType: 'Scene',
            aggregateId: scene.id,
            eventType: 'scene.content.updated',
            payload: {
              sceneId: scene.id,
              chapterId: scene.chapterId,
              contentHash,
              wordCount: scene.wordCount,
              userId,
            },
            createdAt: new Date(),
          },
        });

        return this.toSceneRecord(scene);
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
}
