import { Injectable } from '@nestjs/common';
import { type Prisma, type StoryboardNote } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isStoryboardCardStatus,
  type StoryboardCardStatus,
} from '../domain/storyboard-card-status';
import {
  CreateStoryboardCardData,
  StoryboardCardRecord,
  StoryboardCardRepository,
  UpdateStoryboardCardData,
} from '../ports/storyboard-card-repository.port';

@Injectable()
export class PrismaStoryboardCardRepository implements StoryboardCardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForProject(
    userId: string,
    projectId: string,
  ): Promise<StoryboardCardRecord[] | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    const cards = await this.prisma.storyboardNote.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { sortKey: 'asc' }, { createdAt: 'asc' }],
    });

    return cards.map((card) => this.toStoryboardCardRecord(card));
  }

  async createForUser(
    userId: string,
    data: CreateStoryboardCardData,
  ): Promise<StoryboardCardRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    if (data.chapterId) {
      const chapter = await this.prisma.chapter.findFirst({
        where: {
          id: data.chapterId,
          deletedAt: null,
          book: { projectId: data.projectId },
        },
        select: { id: true },
      });

      if (!chapter) {
        return null;
      }
    }

    if (data.entityIds && data.entityIds.length > 0) {
      const entitiesAreValid = await this.entityIdsBelongToProject(
        data.projectId,
        data.entityIds,
      );

      if (!entitiesAreValid) {
        return null;
      }
    }

    const status = data.status ?? 'ideas';
    const sortKey = data.sortKey ?? (await this.nextSortKey(data.projectId));
    const card = await this.prisma.storyboardNote.create({
      data: {
        projectId: data.projectId,
        ...(data.chapterId !== undefined ? { chapterId: data.chapterId } : {}),
        title: data.title,
        content: data.description ?? '',
        status,
        tags: data.tags ?? [],
        characters: data.characters ?? [],
        entityIds: data.entityIds ?? [],
        sortKey,
      },
    });

    return this.toStoryboardCardRecord(card);
  }

  async findByIdForUser(
    userId: string,
    cardId: string,
  ): Promise<StoryboardCardRecord | null> {
    const card = await this.prisma.storyboardNote.findFirst({
      where: {
        id: cardId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
    });

    return card ? this.toStoryboardCardRecord(card) : null;
  }

  async updateForUser(
    userId: string,
    cardId: string,
    data: UpdateStoryboardCardData,
  ): Promise<StoryboardCardRecord | null> {
    const existing = await this.prisma.storyboardNote.findFirst({
      where: {
        id: cardId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true, projectId: true },
    });

    if (!existing) {
      return null;
    }

    if (data.chapterId) {
      const chapter = await this.prisma.chapter.findFirst({
        where: {
          id: data.chapterId,
          deletedAt: null,
          book: { projectId: existing.projectId },
        },
        select: { id: true },
      });

      if (!chapter) {
        return null;
      }
    }

    if (data.entityIds && data.entityIds.length > 0) {
      const entitiesAreValid = await this.entityIdsBelongToProject(
        existing.projectId,
        data.entityIds,
      );

      if (!entitiesAreValid) {
        return null;
      }
    }

    await this.prisma.storyboardNote.update({
      where: { id: existing.id },
      data: this.toUpdateData(data),
    });

    return this.findByIdForUser(userId, cardId);
  }

  async attachAudioForUser(
    userId: string,
    cardId: string,
    audioStorageKey: string,
    audioDurationSecs: number,
  ): Promise<StoryboardCardRecord | null> {
    const existing = await this.prisma.storyboardNote.findFirst({
      where: {
        id: cardId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true },
    });

    if (!existing) {
      return null;
    }

    await this.prisma.storyboardNote.update({
      where: { id: existing.id },
      data: {
        noteType: 'voice',
        audioStorageKey,
        audioDurationSecs,
      },
    });

    return this.findByIdForUser(userId, cardId);
  }

  async softDeleteForUser(
    userId: string,
    cardId: string,
    deletedAt: Date,
  ): Promise<StoryboardCardRecord | null> {
    const result = await this.prisma.storyboardNote.updateMany({
      where: {
        id: cardId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      data: { deletedAt },
    });

    if (result.count === 0) {
      return null;
    }

    const card = await this.prisma.storyboardNote.findFirst({
      where: { id: cardId, project: { userId } },
    });

    return card ? this.toStoryboardCardRecord(card) : null;
  }

  private async nextSortKey(projectId: string): Promise<string> {
    const count = await this.prisma.storyboardNote.count({
      where: { projectId },
    });

    return String(count + 1).padStart(6, '0');
  }

  private toUpdateData(
    data: UpdateStoryboardCardData,
  ): Prisma.StoryboardNoteUpdateInput {
    return {
      ...(data.chapterId !== undefined ? { chapterId: data.chapterId } : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { content: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(data.characters !== undefined ? { characters: data.characters } : {}),
      ...(data.entityIds !== undefined ? { entityIds: data.entityIds } : {}),
      ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
    };
  }

  private async entityIdsBelongToProject(
    projectId: string,
    entityIds: string[],
  ): Promise<boolean> {
    const uniqueEntityIds = [...new Set(entityIds)];
    const count = await this.prisma.entity.count({
      where: {
        id: { in: uniqueEntityIds },
        projectId,
        deletedAt: null,
      },
    });

    return count === uniqueEntityIds.length;
  }

  private toStoryboardCardRecord(note: StoryboardNote): StoryboardCardRecord {
    const status: StoryboardCardStatus = isStoryboardCardStatus(note.status)
      ? note.status
      : 'ideas';

    return {
      id: note.id,
      projectId: note.projectId,
      chapterId: note.chapterId,
      title: note.title,
      description: note.content,
      status,
      tags: note.tags,
      characters: note.characters,
      entityIds: note.entityIds,
      audioStorageKey: note.audioStorageKey,
      audioDurationSecs: note.audioDurationSecs,
      sortKey: note.sortKey,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
    };
  }
}
