import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ExportSourceRepository,
  ExportSourceRecord,
} from '../export-source.port';

const exportSourceSelect = {
  id: true,
  title: true,
  coverStorageKey: true,
  project: {
    select: {
      user: { select: { name: true, lastname: true, displayName: true } },
    },
  },
  chapters: {
    where: { deletedAt: null },
    orderBy: { sortKey: 'asc' },
    select: {
      id: true,
      title: true,
      scenes: {
        where: { deletedAt: null },
        orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
        select: {
          id: true,
          title: true,
          content: true,
        },
      },
    },
  },
} satisfies Prisma.BookSelect;

@Injectable()
export class PrismaExportSourceAdapter implements ExportSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdForUser(
    userId: string,
    bookId: string,
  ): Promise<ExportSourceRecord | null> {
    const book = await this.prisma.book.findFirst({
      where: {
        id: bookId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: exportSourceSelect,
    });

    return book;
  }
}
