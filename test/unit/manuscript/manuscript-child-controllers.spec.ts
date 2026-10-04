import { BooksController } from '../../../src/manuscript/controllers/books.controller';
import { ChaptersController } from '../../../src/manuscript/controllers/chapters.controller';
import { EditorTextStylesController } from '../../../src/manuscript/controllers/editor-text-styles.controller';
import { ScenesController } from '../../../src/manuscript/controllers/scenes.controller';
import { StoryboardCardsController } from '../../../src/manuscript/controllers/storyboard-cards.controller';
import { StoryboardMatrixController } from '../../../src/manuscript/controllers/storyboard-matrix.controller';
import { SceneStatus } from '../../../src/manuscript/domain/scene-status';
import type { AuthenticatedRequest } from '../../../src/manuscript/controllers/authenticated-request';

const req = { user: { id: 'user-1' } } as AuthenticatedRequest;
const now = new Date('2026-09-01T00:00:00.000Z');
const book = {
  id: 'book-1',
  projectId: 'project-1',
  title: 'Book',
  sortKey: '001',
  createdAt: now,
  updatedAt: now,
};
const chapter = {
  id: 'chapter-1',
  bookId: 'book-1',
  title: 'Chapter',
  sortKey: '001',
  status: SceneStatus.DRAFT,
  wordCount: 0,
  createdAt: now,
  updatedAt: now,
};
const scene = {
  id: 'scene-1',
  chapterId: 'chapter-1',
  title: 'Opening',
  sortKey: '001',
  content: { type: 'doc' },
  contentHash: 'hash-1',
  wordCount: 12,
  povCharacterId: null,
  status: SceneStatus.DRAFT,
  order: 0,
  createdAt: now,
  updatedAt: now,
};
const version = {
  id: 'version-1',
  sceneId: 'scene-1',
  label: 'Draft',
  content: { type: 'doc' },
  contentHash: 'version-hash',
  wordCount: 12,
  createdFromId: null,
  createdAt: now,
  updatedAt: now,
};

describe('manuscript child controllers', () => {
  it('maps book endpoints to the authenticated user and service', async () => {
    const service = {
      create: jest.fn().mockResolvedValue(book),
      getById: jest.fn().mockResolvedValue(book),
      update: jest.fn().mockResolvedValue(book),
      remove: jest.fn().mockResolvedValue(book),
    };
    const controller = new BooksController(service as never);
    const dto = { title: 'Book', sortKey: '001' };

    await expect(
      controller.createBook(req, 'project-1', dto),
    ).resolves.toMatchObject(book);
    await expect(controller.getBookById(req, 'book-1')).resolves.toMatchObject(
      book,
    );
    await expect(
      controller.updateBook(req, 'book-1', { title: 'Renamed' }),
    ).resolves.toMatchObject(book);
    await expect(controller.removeBook(req, 'book-1')).resolves.toMatchObject(
      book,
    );
    expect(service.create).toHaveBeenCalledWith('user-1', 'project-1', dto);
    expect(service.getById).toHaveBeenCalledWith('user-1', 'book-1');
    expect(service.update).toHaveBeenCalledWith('user-1', 'book-1', {
      title: 'Renamed',
    });
    expect(service.remove).toHaveBeenCalledWith('user-1', 'book-1');
  });

  it('maps chapter endpoints to the authenticated user and service', async () => {
    const service = {
      create: jest.fn().mockResolvedValue(chapter),
      getById: jest.fn().mockResolvedValue(chapter),
      update: jest.fn().mockResolvedValue(chapter),
      remove: jest.fn().mockResolvedValue(chapter),
    };
    const controller = new ChaptersController(service as never);
    const dto = { title: 'Chapter', sortKey: '001' };

    await expect(
      controller.createChapter(req, 'book-1', dto),
    ).resolves.toMatchObject(chapter);
    await expect(
      controller.getChapterById(req, 'chapter-1'),
    ).resolves.toMatchObject(chapter);
    await expect(
      controller.updateChapter(req, 'chapter-1', { title: 'Renamed' }),
    ).resolves.toMatchObject(chapter);
    await expect(
      controller.removeChapter(req, 'chapter-1'),
    ).resolves.toMatchObject(chapter);
    expect(service.create).toHaveBeenCalledWith('user-1', 'book-1', dto);
    expect(service.getById).toHaveBeenCalledWith('user-1', 'chapter-1');
    expect(service.update).toHaveBeenCalledWith('user-1', 'chapter-1', {
      title: 'Renamed',
    });
    expect(service.remove).toHaveBeenCalledWith('user-1', 'chapter-1');
  });

  it('handles scene CRUD, content saves, and both scene update branches', async () => {
    const saved = { scene, contentChanged: true };
    const service = {
      create: jest.fn().mockResolvedValue(scene),
      getById: jest.fn().mockResolvedValue(scene),
      update: jest.fn().mockResolvedValue(scene),
      updateContent: jest.fn().mockResolvedValue(saved),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ScenesController(service as never);
    const createDto = {
      title: 'Opening',
      sortKey: '001',
      content: scene.content,
    };

    await expect(
      controller.createScene(req, 'chapter-1', createDto),
    ).resolves.toMatchObject({ id: scene.id });
    await expect(
      controller.getSceneById(req, 'scene-1'),
    ).resolves.toMatchObject({ id: scene.id, hash: 'hash-1' });
    await expect(
      controller.updateScene(req, 'scene-1', { title: 'New title' }),
    ).resolves.toMatchObject({ id: scene.id });
    await expect(
      controller.updateScene(req, 'scene-1', {
        content: scene.content,
        wordCount: 25,
      }),
    ).resolves.toMatchObject({ contentChanged: true });
    await expect(
      controller.updateScene(req, 'scene-1', { content: scene.content }),
    ).resolves.toMatchObject({ contentChanged: true });
    await expect(
      controller.removeScene(req, 'scene-1'),
    ).resolves.toBeUndefined();
    expect(service.create).toHaveBeenCalledWith(
      'user-1',
      'chapter-1',
      createDto,
    );
    expect(service.updateContent).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'scene-1',
      { content: scene.content, wordCount: 25 },
    );
    expect(service.updateContent).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'scene-1',
      { content: scene.content },
    );
    expect(service.remove).toHaveBeenCalledWith('user-1', 'scene-1');
  });

  it('maps scene version endpoints and selects content or metadata updates', async () => {
    const service = {
      listVersions: jest.fn().mockResolvedValue([version]),
      createVersion: jest.fn().mockResolvedValue(version),
      getVersion: jest.fn().mockResolvedValue(version),
      updateVersion: jest.fn().mockResolvedValue(version),
      updateVersionContent: jest
        .fn()
        .mockResolvedValue({ version, contentChanged: false }),
      restoreVersion: jest
        .fn()
        .mockResolvedValue({ scene, contentChanged: true }),
      removeVersion: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ScenesController(service as never);
    const createDto = { label: 'Draft' };

    await expect(
      controller.listSceneVersions(req, 'scene-1'),
    ).resolves.toMatchObject([{ id: 'version-1', hash: 'version-hash' }]);
    await expect(
      controller.createSceneVersion(req, 'scene-1', createDto),
    ).resolves.toMatchObject({ id: 'version-1' });
    await expect(
      controller.getSceneVersion(req, 'scene-1', 'version-1'),
    ).resolves.toMatchObject({ id: 'version-1' });
    await expect(
      controller.updateSceneVersion(req, 'scene-1', 'version-1', {
        label: 'Revised',
      }),
    ).resolves.toMatchObject({ id: 'version-1' });
    await expect(
      controller.updateSceneVersion(req, 'scene-1', 'version-1', {
        content: scene.content,
        wordCount: 12,
      }),
    ).resolves.toMatchObject({ contentChanged: false });
    await expect(
      controller.restoreSceneVersion(req, 'scene-1', 'version-1'),
    ).resolves.toMatchObject({ contentChanged: true });
    await expect(
      controller.removeSceneVersion(req, 'scene-1', 'version-1'),
    ).resolves.toBeUndefined();
    expect(service.createVersion).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      createDto,
    );
    expect(service.updateVersionContent).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
      { content: scene.content, wordCount: 12 },
    );
    expect(service.restoreVersion).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
    );
    expect(service.removeVersion).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
    );
  });

  it('forwards editor style list, create, update, and removal operations', async () => {
    const style = { id: 'style-1', projectId: 'project-1', name: 'Body' };
    const service = {
      list: jest.fn().mockResolvedValue([style]),
      create: jest.fn().mockResolvedValue(style),
      update: jest.fn().mockResolvedValue(style),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new EditorTextStylesController(service as never);
    const dto = { name: 'Body', kind: 'paragraph', definition: {} };

    await expect(controller.list(req, 'project-1')).resolves.toEqual([style]);
    await expect(
      controller.create(req, 'project-1', dto as never),
    ).resolves.toEqual(style);
    await expect(
      controller.update(req, 'project-1', 'style-1', dto as never),
    ).resolves.toEqual(style);
    await expect(
      controller.remove(req, 'project-1', 'style-1'),
    ).resolves.toBeUndefined();
    expect(service.list).toHaveBeenCalledWith('user-1', 'project-1');
    expect(service.create).toHaveBeenCalledWith('user-1', 'project-1', dto);
    expect(service.update).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'style-1',
      dto,
    );
    expect(service.remove).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'style-1',
    );
  });

  it('maps storyboard card endpoints and wraps audio URLs', async () => {
    const card = {
      id: 'card-1',
      projectId: 'project-1',
      chapterId: null,
      title: 'Opening',
      description: '',
      status: 'planned',
      tags: [],
      characters: [],
      entityIds: [],
      audioStorageKey: null,
      audioDurationSecs: null,
      sortKey: '001',
      createdAt: now,
      updatedAt: now,
    };
    const service = {
      listByProject: jest.fn().mockResolvedValue([card]),
      create: jest.fn().mockResolvedValue(card),
      update: jest.fn().mockResolvedValue(card),
      attachAudio: jest.fn().mockResolvedValue(card),
      getAudioUrl: jest.fn().mockResolvedValue('https://audio.example/test'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new StoryboardCardsController(service as never);
    const dto = { title: 'Opening' };

    await expect(controller.listCards(req, 'project-1')).resolves.toMatchObject(
      [{ id: 'card-1', hasAudio: false }],
    );
    await expect(
      controller.createCard(req, 'project-1', dto as never),
    ).resolves.toMatchObject({ id: 'card-1' });
    await expect(
      controller.updateCard(req, 'card-1', { title: 'Changed' }),
    ).resolves.toMatchObject({ id: 'card-1' });
    await expect(
      controller.attachAudio(req, 'card-1', {
        audioStorageKey: 'key',
      } as never),
    ).resolves.toMatchObject({ id: 'card-1' });
    await expect(controller.getAudioUrl(req, 'card-1')).resolves.toEqual({
      url: 'https://audio.example/test',
    });
    await expect(controller.removeCard(req, 'card-1')).resolves.toBeUndefined();
    expect(service.create).toHaveBeenCalledWith('user-1', 'project-1', dto);
    expect(service.attachAudio).toHaveBeenCalledWith('user-1', 'card-1', {
      audioStorageKey: 'key',
    });
  });

  it('maps storyboard matrix arc and note endpoints', async () => {
    const note = {
      id: 'note-1',
      arcId: 'arc-1',
      chapterId: 'chapter-1',
      content: 'Beat',
      sortKey: '001',
      createdAt: now,
      updatedAt: now,
    };
    const arc = {
      id: 'arc-1',
      projectId: 'project-1',
      title: 'Arc',
      sourceType: 'CUSTOM',
      customType: null,
      entityId: null,
      relationshipId: null,
      sortKey: '001',
      createdAt: now,
      updatedAt: now,
      notes: [note],
    };
    const service = {
      listArcs: jest.fn().mockResolvedValue([arc]),
      createArc: jest.fn().mockResolvedValue(arc),
      removeArc: jest.fn().mockResolvedValue(undefined),
      createNote: jest.fn().mockResolvedValue(note),
      updateNote: jest.fn().mockResolvedValue(note),
      removeNote: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new StoryboardMatrixController(service as never);
    const arcDto = { title: 'Arc', sourceType: 'CUSTOM' };
    const noteDto = { chapterId: 'chapter-1', content: 'Beat' };

    await expect(controller.listArcs(req, 'project-1')).resolves.toMatchObject([
      { id: 'arc-1', notes: [{ id: 'note-1' }] },
    ]);
    await expect(
      controller.createArc(req, 'project-1', arcDto as never),
    ).resolves.toMatchObject({ id: 'arc-1' });
    await expect(controller.removeArc(req, 'arc-1')).resolves.toBeUndefined();
    await expect(
      controller.createNote(req, 'arc-1', noteDto as never),
    ).resolves.toMatchObject({ id: 'note-1' });
    await expect(
      controller.updateNote(req, 'note-1', { content: 'Changed' }),
    ).resolves.toMatchObject({ content: 'Beat' });
    await expect(controller.removeNote(req, 'note-1')).resolves.toBeUndefined();
    expect(service.createArc).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      arcDto,
    );
    expect(service.createNote).toHaveBeenCalledWith('user-1', 'arc-1', noteDto);
    expect(service.updateNote).toHaveBeenCalledWith('user-1', 'note-1', {
      content: 'Changed',
    });
  });
});
