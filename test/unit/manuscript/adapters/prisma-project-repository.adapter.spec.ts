import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { PrismaProjectRepository } from '../../../../src/manuscript/adapters/prisma-project-repository.adapter';
import { type ProjectRecord } from '../../../../src/manuscript/ports/project-repository.port';

interface MockPrismaService {
  project: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('PrismaProjectRepository', () => {
  let repository: PrismaProjectRepository;
  let prisma: MockPrismaService;

  const now = new Date('2026-06-09T00:00:00.000Z');
  const project: ProjectRecord = {
    id: 'project-1',
    userId: 'user-1',
    title: 'Plum draft',
    description: null,
    genre: 'Fantasy',
    genreRules: null,
    wordCountTarget: null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaProjectRepository,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findMany: jest.fn(),
              create: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    repository = module.get(PrismaProjectRepository);
    prisma = module.get<MockPrismaService>(PrismaService);
  });

  it('lists non-deleted projects ordered by last update', async () => {
    prisma.project.findMany.mockResolvedValue([project]);

    const result = await repository.listByUser('user-1');

    expect(result).toEqual([project]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('creates a project with only provided optional fields', async () => {
    prisma.project.create.mockResolvedValue(project);

    const result = await repository.create({
      userId: 'user-1',
      title: 'Plum draft',
      genre: 'Fantasy',
    });

    expect(result).toEqual(project);
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Plum draft',
        genre: 'Fantasy',
      },
    });
  });

  it('finds a project tree owned by the user', async () => {
    const projectTree = {
      ...project,
      books: [
        {
          id: 'book-1',
          title: 'Book one',
          chapters: [
            {
              id: 'chapter-1',
              title: 'Chapter one',
              scenes: [
                {
                  id: 'scene-1',
                  title: 'Opening',
                  wordCount: 1200,
                },
              ],
            },
          ],
        },
      ],
    };
    prisma.project.findFirst.mockResolvedValue(projectTree);

    const result = await repository.findByIdForUser('user-1', 'project-1');

    expect(result).toEqual(projectTree);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'user-1', deletedAt: null },
      select: {
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
                    wordCount: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('returns null when updating a missing project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    const result = await repository.updateForUser('user-1', 'missing', {
      title: 'New title',
    });

    expect(result).toBeNull();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('updates an owned project', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.project.update.mockResolvedValue(project);

    const result = await repository.updateForUser('user-1', 'project-1', {
      title: 'New title',
      status: 'active',
    });

    expect(result).toEqual(project);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { title: 'New title', status: 'active' },
    });
  });

  it('soft deletes an owned project and its manuscript tree in one transaction', async () => {
    const deletedAt = new Date('2026-06-09T12:00:00.000Z');
    const tx = {
      scene: { updateMany: jest.fn() },
      chapter: { updateMany: jest.fn() },
      book: { updateMany: jest.fn() },
      project: { update: jest.fn().mockResolvedValue(project) },
    };
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<ProjectRecord>) =>
        callback(tx),
    );

    const result = await repository.softDeleteForUser(
      'user-1',
      'project-1',
      deletedAt,
    );

    expect(result).toEqual(project);
    expect(tx.scene.updateMany).toHaveBeenCalledWith({
      where: {
        chapter: { book: { projectId: 'project-1' } },
        deletedAt: null,
      },
      data: { deletedAt },
    });
    expect(tx.chapter.updateMany).toHaveBeenCalledWith({
      where: { book: { projectId: 'project-1' }, deletedAt: null },
      data: { deletedAt },
    });
    expect(tx.book.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', deletedAt: null },
      data: { deletedAt },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { deletedAt },
    });
  });
});
