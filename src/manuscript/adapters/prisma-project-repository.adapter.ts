import { Injectable } from '@nestjs/common';
import { Prisma, type Project } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toProjectStatus } from '../domain/project-status';
import {
  CreateProjectData,
  ProjectRecord,
  ProjectRepository,
  ProjectWithTreeRecord,
  UpdateProjectData,
} from '../ports/project-repository.port';

const projectTreeSelect = {
  id: true,
  userId: true,
  title: true,
  description: true,
  genre: true,
  genreRules: true,
  wordCountTarget: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  books: {
    where: { deletedAt: null },
    orderBy: { sortKey: 'asc' },
    select: {
      id: true,
      title: true,
      sortKey: true,
      chapters: {
        where: { deletedAt: null },
        orderBy: { sortKey: 'asc' },
        select: {
          id: true,
          title: true,
          sortKey: true,
          scenes: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
            select: {
              id: true,
              title: true,
              sortKey: true,
              wordCount: true,
              order: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByUser(userId: string): Promise<ProjectRecord[]> {
    const projects = await this.prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return projects.map((project) => this.toProjectRecord(project));
  }

  async create(data: CreateProjectData): Promise<ProjectRecord> {
    const project = await this.prisma.project.create({
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
    return this.toProjectRecord(project);
  }

  async findByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectWithTreeRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: projectTreeSelect,
    });

    if (!project) {
      return null;
    }

    return {
      ...this.toProjectRecord(project),
      books: project.books,
    };
  }

  async updateForUser(
    userId: string,
    projectId: string,
    data: UpdateProjectData,
  ): Promise<ProjectRecord | null> {
    const result = await this.prisma.project.updateMany({
      where: { id: projectId, userId, deletedAt: null },
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

    if (result.count === 0) {
      return null;
    }

    return this.findRecordByIdForUser(userId, projectId);
  }

  softDeleteForUser(
    userId: string,
    projectId: string,
    deletedAt: Date,
  ): Promise<ProjectRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { id: projectId, userId, deletedAt: null },
        data: { deletedAt },
      });

      if (result.count === 0) {
        return null;
      }

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

      const deletedProject = await tx.project.findFirst({
        where: { id: projectId, userId },
      });

      return deletedProject ? this.toProjectRecord(deletedProject) : null;
    });
  }

  private async findRecordByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
    });

    return project ? this.toProjectRecord(project) : null;
  }

  private toProjectRecord(project: Project): ProjectRecord {
    return {
      id: project.id,
      userId: project.userId,
      title: project.title,
      description: project.description,
      genre: project.genre,
      genreRules: project.genreRules,
      wordCountTarget: project.wordCountTarget,
      status: toProjectStatus(project.status),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      deletedAt: project.deletedAt,
    };
  }
}
