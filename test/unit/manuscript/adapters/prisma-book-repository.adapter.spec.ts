import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaBookRepository } from '../../../../src/manuscript/adapters/prisma-book-repository.adapter';
import { PrismaService } from '../../../../src/prisma/prisma.service';

interface MockPrismaService {
  project: {
    findFirst: jest.Mock;
  };
  book: {
    create: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('PrismaBookRepository', () => {
  let repository: PrismaBookRepository;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaBookRepository,
        {
          provide: PrismaService,
          useValue: {
            project: { findFirst: jest.fn() },
            book: {
              create: jest.fn(),
              findFirst: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    repository = module.get(PrismaBookRepository);
    prisma = module.get<MockPrismaService>(PrismaService);
  });

  it('translates duplicate sort keys to ConflictException on create', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.book.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Book one',
        sortKey: '001',
      }),
    ).rejects.toThrow(
      new ConflictException('Manuscript item already exists at this sort key'),
    );
  });
});
