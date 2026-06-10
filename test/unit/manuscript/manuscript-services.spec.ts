import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { SceneStatus } from '../../../src/manuscript/domain/scene-status';
import {
  BOOK_REPOSITORY,
  type BookRecord,
  type BookRepository,
} from '../../../src/manuscript/ports/book-repository.port';
import {
  CHAPTER_REPOSITORY,
  type ChapterRecord,
  type ChapterRepository,
} from '../../../src/manuscript/ports/chapter-repository.port';
import {
  SCENE_REPOSITORY,
  type SceneRecord,
  type SceneRepository,
} from '../../../src/manuscript/ports/scene-repository.port';
import { BookService } from '../../../src/manuscript/services/book.service';
import { ChapterService } from '../../../src/manuscript/services/chapter.service';
import { SceneService } from '../../../src/manuscript/services/scene.service';

describe('Manuscript child services', () => {
  let bookService: BookService;
  let chapterService: ChapterService;
  let sceneService: SceneService;
  let bookRepository: jest.Mocked<BookRepository>;
  let chapterRepository: jest.Mocked<ChapterRepository>;
  let sceneRepository: jest.Mocked<SceneRepository>;

  const now = new Date('2026-06-09T00:00:00.000Z');
  const book: BookRecord = {
    id: 'book-1',
    projectId: 'project-1',
    title: 'Book one',
    sortKey: '001',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const chapter: ChapterRecord = {
    id: 'chapter-1',
    bookId: 'book-1',
    title: 'Chapter one',
    sortKey: '001',
    status: SceneStatus.DRAFT,
    wordCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const scene: SceneRecord = {
    id: 'scene-1',
    chapterId: 'chapter-1',
    title: 'Opening',
    sortKey: '001',
    content: { type: 'doc' },
    contentHash: null,
    wordCount: 10,
    povCharacterId: null,
    status: SceneStatus.DRAFT,
    order: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookService,
        ChapterService,
        SceneService,
        {
          provide: BOOK_REPOSITORY,
          useValue: {
            createForUser: jest.fn(),
            findByIdForUser: jest.fn(),
            updateForUser: jest.fn(),
            softDeleteForUser: jest.fn(),
          },
        },
        {
          provide: CHAPTER_REPOSITORY,
          useValue: {
            createForUser: jest.fn(),
            findByIdForUser: jest.fn(),
            updateForUser: jest.fn(),
            softDeleteForUser: jest.fn(),
          },
        },
        {
          provide: SCENE_REPOSITORY,
          useValue: {
            createForUser: jest.fn(),
            findByIdForUser: jest.fn(),
            updateForUser: jest.fn(),
            updateContentForUser: jest.fn(),
            softDeleteForUser: jest.fn(),
          },
        },
      ],
    }).compile();

    bookService = module.get(BookService);
    chapterService = module.get(ChapterService);
    sceneService = module.get(SceneService);
    bookRepository = module.get(BOOK_REPOSITORY);
    chapterRepository = module.get(CHAPTER_REPOSITORY);
    sceneRepository = module.get(SCENE_REPOSITORY);
  });

  it('creates child manuscript records through repository ports', async () => {
    bookRepository.createForUser.mockResolvedValue(book);
    chapterRepository.createForUser.mockResolvedValue(chapter);
    sceneRepository.createForUser.mockResolvedValue(scene);

    await expect(
      bookService.create('user-1', 'project-1', {
        title: book.title,
        sortKey: book.sortKey,
      }),
    ).resolves.toEqual(book);
    await expect(
      chapterService.create('user-1', 'book-1', {
        title: chapter.title,
        sortKey: chapter.sortKey,
      }),
    ).resolves.toEqual(chapter);
    await expect(
      sceneService.create('user-1', 'chapter-1', {
        title: 'Opening',
        sortKey: scene.sortKey,
        content: { type: 'doc' },
      }),
    ).resolves.toEqual(scene);

    expect(bookRepository.createForUser).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      title: book.title,
      sortKey: book.sortKey,
    });
    expect(chapterRepository.createForUser).toHaveBeenCalledWith('user-1', {
      bookId: 'book-1',
      title: chapter.title,
      sortKey: chapter.sortKey,
    });
    expect(sceneRepository.createForUser).toHaveBeenCalledWith('user-1', {
      chapterId: 'chapter-1',
      title: scene.title,
      sortKey: scene.sortKey,
      content: { type: 'doc' },
    });
  });

  it('throws clear NotFoundException messages for missing parents or records', async () => {
    bookRepository.createForUser.mockResolvedValue(null);
    chapterRepository.createForUser.mockResolvedValue(null);
    sceneRepository.updateContentForUser.mockResolvedValue(null);

    await expect(
      bookService.create('user-1', 'missing', {
        title: 'Book',
        sortKey: '001',
      }),
    ).rejects.toThrow(new NotFoundException('Project not found'));
    await expect(
      chapterService.create('user-1', 'missing', {
        title: 'Chapter',
        sortKey: '001',
        status: SceneStatus.DRAFT,
      }),
    ).rejects.toThrow(new NotFoundException('Book not found'));
    await expect(
      sceneService.updateContent('user-1', 'missing', {
        content: { type: 'doc' },
      }),
    ).rejects.toThrow(new NotFoundException('Scene not found'));
  });
});
