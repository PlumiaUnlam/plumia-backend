import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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

    return this.prisma.scene.create({
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
  }

  findByIdForUser(
    userId: string,
    sceneId: string,
  ): Promise<SceneRecord | null> {
    return this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
    });
  }

  async updateForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneData,
  ): Promise<SceneRecord | null> {
    const scene = await this.findOwnedScene(userId, sceneId);
    if (!scene) {
      return null;
    }

    return this.prisma.scene.update({
      where: { id: sceneId },
      data: this.toSceneUpdateData(data),
    });
  }

  async updateContentForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneContentData,
  ): Promise<SceneRecord | null> {
    const scene = await this.findOwnedScene(userId, sceneId);
    if (!scene) {
      return null;
    }

    return this.prisma.scene.update({
      where: { id: sceneId },
      data: {
        content: data.content as Prisma.InputJsonValue,
        ...(data.wordCount !== undefined ? { wordCount: data.wordCount } : {}),
      },
    });
  }

  async softDeleteForUser(
    userId: string,
    sceneId: string,
    deletedAt: Date,
  ): Promise<SceneRecord | null> {
    const scene = await this.findOwnedScene(userId, sceneId);
    if (!scene) {
      return null;
    }

    return this.prisma.scene.update({
      where: { id: sceneId },
      data: { deletedAt },
    });
  }

  private findOwnedScene(
    userId: string,
    sceneId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId } } },
      },
      select: { id: true },
    });
  }

  private toSceneUpdateData(data: UpdateSceneData): Prisma.SceneUpdateInput {
    return {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
      ...(data.content !== undefined
        ? { content: data.content as Prisma.InputJsonValue }
        : {}),
      ...(data.wordCount !== undefined ? { wordCount: data.wordCount } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    };
  }
}
