import { Injectable } from '@nestjs/common';
import { Prisma, type Scene } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toSceneStatus } from '../domain/scene-status';
import {
  CreateSceneData,
  SceneRecord,
  SceneRepository,
  UpdateSceneContentData,
  UpdateSceneData,
} from '../ports/scene-repository.port';

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

    const scene = await this.prisma.scene.create({
      data: {
        chapterId: data.chapterId,
        sortKey: data.sortKey,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined
          ? { content: data.content as Prisma.InputJsonValue }
          : {}),
        ...(data.wordCount !== undefined ? { wordCount: data.wordCount } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });
    return this.toSceneRecord(scene);
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
    const result = await this.prisma.scene.updateMany({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
      data: this.toSceneUpdateData(data),
    });

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
    const result = await this.prisma.scene.updateMany({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
      data: {
        content: data.content as Prisma.InputJsonValue,
        ...(data.wordCount !== undefined ? { wordCount: data.wordCount } : {}),
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findByIdForUser(userId, sceneId);
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
