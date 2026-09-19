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
  books: {
    where: { deletedAt: null },
    orderBy: { sortKey: 'asc' },
    select: {
      title: true,
      chapters: {
        where: { deletedAt: null },
        orderBy: { sortKey: 'asc' },
        select: {
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
    },
  },
} satisfies Prisma.ProjectSelect;

@Injectable()
export class PrismaExportSourceAdapter implements ExportSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ExportSourceRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: exportSourceSelect,
    });

    return project;
  }
}
