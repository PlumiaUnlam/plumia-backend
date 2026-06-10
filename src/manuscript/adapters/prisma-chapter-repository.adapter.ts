import { Injectable } from '@nestjs/common';
import { type Chapter } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toSceneStatus } from '../domain/scene-status';
import {
  ChapterRecord,
  ChapterRepository,
  CreateChapterData,
  UpdateChapterData,
} from '../ports/chapter-repository.port';
import { translatePrismaConflict } from './prisma-error';

@Injectable()
export class PrismaChapterRepository implements ChapterRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(
    userId: string,
    data: CreateChapterData,
  ): Promise<ChapterRecord | null> {
    const book = await this.prisma.book.findFirst({
      where: { id: data.bookId, deletedAt: null, project: { userId } },
      select: { id: true },
    });

    if (!book) {
      return null;
    }

    let chapter: Chapter;
    try {
      chapter = await this.prisma.chapter.create({
        data: {
          bookId: data.bookId,
          title: data.title,
          sortKey: data.sortKey,
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
    } catch (error: unknown) {
      translatePrismaConflict(error);
    }
    return this.toChapterRecord(chapter);
  }

  async findByIdForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null> {
    const chapter = await this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        deletedAt: null,
        book: { project: { userId } },
      },
    });

    return chapter ? this.toChapterRecord(chapter) : null;
  }

  async updateForUser(
    userId: string,
    chapterId: string,
    data: UpdateChapterData,
  ): Promise<ChapterRecord | null> {
    let result: { count: number };
    try {
      result = await this.prisma.chapter.updateMany({
        where: {
          id: chapterId,
          deletedAt: null,
          book: { project: { userId } },
        },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
    } catch (error: unknown) {
      translatePrismaConflict(error);
    }

    if (result.count === 0) {
      return null;
    }

    return this.findByIdForUser(userId, chapterId);
  }

  async softDeleteForUser(
    userId: string,
    chapterId: string,
    deletedAt: Date,
  ): Promise<ChapterRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.chapter.updateMany({
        where: {
          id: chapterId,
          deletedAt: null,
          book: { project: { userId } },
        },
        data: { deletedAt },
      });

      if (result.count === 0) {
        return null;
      }

      await tx.scene.updateMany({
        where: { chapterId, deletedAt: null },
        data: { deletedAt },
      });

      const chapter = await tx.chapter.findFirst({
        where: { id: chapterId, book: { project: { userId } } },
      });

      return chapter ? this.toChapterRecord(chapter) : null;
    });
  }

  private toChapterRecord(chapter: Chapter): ChapterRecord {
    return {
      id: chapter.id,
      bookId: chapter.bookId,
      title: chapter.title,
      sortKey: chapter.sortKey,
      status: toSceneStatus(chapter.status),
      wordCount: chapter.wordCount,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
      deletedAt: chapter.deletedAt,
    };
  }
}
