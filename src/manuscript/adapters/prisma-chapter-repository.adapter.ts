import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChapterRecord,
  ChapterRepository,
  CreateChapterData,
  UpdateChapterData,
} from '../ports/chapter-repository.port';

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

    return this.prisma.chapter.create({
      data: {
        bookId: data.bookId,
        title: data.title,
        sortKey: data.sortKey,
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  }

  findByIdForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null> {
    return this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        deletedAt: null,
        book: { project: { userId } },
      },
    });
  }

  async updateForUser(
    userId: string,
    chapterId: string,
    data: UpdateChapterData,
  ): Promise<ChapterRecord | null> {
    const chapter = await this.findOwnedChapter(userId, chapterId);
    if (!chapter) {
      return null;
    }

    return this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  }

  async softDeleteForUser(
    userId: string,
    chapterId: string,
    deletedAt: Date,
  ): Promise<ChapterRecord | null> {
    const chapter = await this.findOwnedChapter(userId, chapterId);
    if (!chapter) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.scene.updateMany({
        where: { chapterId, deletedAt: null },
        data: { deletedAt },
      });
      return tx.chapter.update({
        where: { id: chapterId },
        data: { deletedAt },
      });
    });
  }

  private findOwnedChapter(
    userId: string,
    chapterId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        deletedAt: null,
        book: { project: { userId } },
      },
      select: { id: true },
    });
  }
}
