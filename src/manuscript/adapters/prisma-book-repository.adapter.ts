import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BookRecord,
  BookRepository,
  CreateBookData,
  UpdateBookData,
} from '../ports/book-repository.port';
import { translatePrismaConflict } from './prisma-error';

@Injectable()
export class PrismaBookRepository implements BookRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(
    userId: string,
    data: CreateBookData,
  ): Promise<BookRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    try {
      return await this.prisma.book.create({
        data: {
          projectId: data.projectId,
          title: data.title,
          sortKey: data.sortKey,
        },
      });
    } catch (error: unknown) {
      translatePrismaConflict(error);
    }
  }

  findByIdForUser(userId: string, bookId: string): Promise<BookRecord | null> {
    return this.prisma.book.findFirst({
      where: { id: bookId, deletedAt: null, project: { userId } },
    });
  }

  async updateForUser(
    userId: string,
    bookId: string,
    data: UpdateBookData,
  ): Promise<BookRecord | null> {
    let result: { count: number };
    try {
      result = await this.prisma.book.updateMany({
        where: { id: bookId, deletedAt: null, project: { userId } },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.sortKey !== undefined ? { sortKey: data.sortKey } : {}),
        },
      });
    } catch (error: unknown) {
      translatePrismaConflict(error);
    }

    if (result.count === 0) {
      return null;
    }

    return this.findByIdForUser(userId, bookId);
  }

  async softDeleteForUser(
    userId: string,
    bookId: string,
    deletedAt: Date,
  ): Promise<BookRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.book.updateMany({
        where: { id: bookId, deletedAt: null, project: { userId } },
        data: { deletedAt },
      });

      if (result.count === 0) {
        return null;
      }

      await tx.scene.updateMany({
        where: { chapter: { bookId }, deletedAt: null },
        data: { deletedAt },
      });
      await tx.chapter.updateMany({
        where: { bookId, deletedAt: null },
        data: { deletedAt },
      });

      return tx.book.findFirst({
        where: { id: bookId, project: { userId } },
      });
    });
  }
}
