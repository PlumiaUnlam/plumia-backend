import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProjectData,
  ProjectRecord,
  ProjectRepository,
  ProjectWithTreeRecord,
  UpdateProjectData,
} from '../ports/project-repository.port';

const projectTreeInclude = {
  books: {
    where: { deletedAt: null },
    orderBy: { sortKey: 'asc' },
    include: {
      chapters: {
        where: { deletedAt: null },
        orderBy: { sortKey: 'asc' },
        include: {
          scenes: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectInclude;

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByUser(userId: string): Promise<ProjectRecord[]> {
    return this.prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  create(data: CreateProjectData): Promise<ProjectRecord> {
    return this.prisma.project.create({
      data: {
        userId: data.userId,
        title: data.title,
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.genre !== undefined ? { genre: data.genre } : {}),
        ...(data.genreRules !== undefined
          ? { genreRules: data.genreRules as Prisma.InputJsonValue }
          : {}),
        ...(data.wordCountTarget !== undefined
          ? { wordCountTarget: data.wordCountTarget }
          : {}),
      },
    });
  }

  findByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectWithTreeRecord | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      include: projectTreeInclude,
    });
  }

  async updateForUser(
    userId: string,
    projectId: string,
    data: UpdateProjectData,
  ): Promise<ProjectRecord | null> {
    const project = await this.findOwnedProject(userId, projectId);
    if (!project) {
      return null;
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.genre !== undefined ? { genre: data.genre } : {}),
        ...(data.genreRules !== undefined
          ? { genreRules: data.genreRules as Prisma.InputJsonValue }
          : {}),
        ...(data.wordCountTarget !== undefined
          ? { wordCountTarget: data.wordCountTarget }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  }

  async softDeleteForUser(
    userId: string,
    projectId: string,
    deletedAt: Date,
  ): Promise<ProjectRecord | null> {
    const project = await this.findOwnedProject(userId, projectId);
    if (!project) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.scene.updateMany({
        where: {
          chapter: {
            book: {
              projectId,
            },
          },
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.chapter.updateMany({
        where: {
          book: {
            projectId,
          },
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.book.updateMany({
        where: { projectId, deletedAt: null },
        data: { deletedAt },
      });
      return tx.project.update({
        where: { id: projectId },
        data: { deletedAt },
      });
    });
  }

  private findOwnedProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
  }
}
