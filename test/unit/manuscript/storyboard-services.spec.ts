import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { StoryboardCardService } from '../../../src/manuscript/services/storyboard-card.service';
import { StoryboardMatrixService } from '../../../src/manuscript/services/storyboard-matrix.service';
import {
  type StoryboardCardRecord,
  type StoryboardCardRepository,
} from '../../../src/manuscript/ports/storyboard-card-repository.port';
import type { StorageService } from '../../../src/storage/storage.service';

const now = new Date('2026-09-01T00:00:00.000Z');
const card: StoryboardCardRecord = {
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
  sortKey: '000001',
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

describe('StoryboardCardService', () => {
  let service: StoryboardCardService;
  let repository: jest.Mocked<StoryboardCardRepository>;
  let storage: jest.Mocked<
    Pick<
      StorageService,
      'headFile' | 'generatePresignedGetUrl' | 'deleteObject'
    >
  >;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository = {
      listForProject: jest.fn(),
      createForUser: jest.fn(),
      updateForUser: jest.fn(),
      findByIdForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
      attachAudioForUser: jest.fn(),
      scheduleAudioCleanup: jest.fn(),
    };
    storage = {
      headFile: jest.fn(),
      generatePresignedGetUrl: jest.fn(),
      deleteObject: jest.fn(),
    };
    service = new StoryboardCardService(repository, storage as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists project cards and reports an inaccessible project', async () => {
    repository.listForProject.mockResolvedValue([card]);
    await expect(service.listByProject('user-1', 'project-1')).resolves.toEqual(
      [card],
    );
    expect(repository.listForProject).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    repository.listForProject.mockResolvedValue(null);
    await expect(service.listByProject('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
  });

  it('creates and updates cards using only fields present in the request', async () => {
    repository.createForUser.mockResolvedValue(card);
    const createDto = {
      title: 'Opening',
      description: 'First beat',
      status: 'in-progress',
      tags: ['one'],
      characters: ['Mara'],
      entityIds: ['entity-1'],
      chapterId: 'chapter-1',
      sortKey: '000002',
    };
    await expect(
      service.create('user-1', 'project-1', createDto as never),
    ).resolves.toEqual(card);
    expect(repository.createForUser).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      title: 'Opening',
      description: 'First beat',
      status: 'in-progress',
      tags: ['one'],
      characters: ['Mara'],
      entityIds: ['entity-1'],
      chapterId: 'chapter-1',
      sortKey: '000002',
    });
    repository.createForUser.mockResolvedValue(null);
    await expect(
      service.create('user-1', 'missing', { title: 'X' }),
    ).rejects.toThrow(new NotFoundException('Project or chapter not found'));

    repository.updateForUser.mockResolvedValue(card);
    await expect(
      service.update('user-1', 'card-1', {
        title: 'New',
        status: 'in-progress',
      } as never),
    ).resolves.toEqual(card);
    expect(repository.updateForUser).toHaveBeenCalledWith('user-1', 'card-1', {
      title: 'New',
      status: 'in-progress',
    });
    await service.update('user-1', 'card-1', {});
    expect(repository.updateForUser).toHaveBeenLastCalledWith(
      'user-1',
      'card-1',
      {},
    );
    repository.updateForUser.mockResolvedValue(null);
    await expect(service.update('user-1', 'missing', {})).rejects.toThrow(
      new NotFoundException('Storyboard card not found'),
    );
  });

  it('soft deletes cards and removes their audio, scheduling cleanup on storage failure', async () => {
    repository.findByIdForUser.mockResolvedValue({
      ...card,
      audioStorageKey: 'storyboard-audio/card-1/old.webm',
    });
    repository.softDeleteForUser.mockResolvedValue({
      ...card,
      audioStorageKey: null,
    });
    storage.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));
    repository.scheduleAudioCleanup.mockResolvedValue(undefined);

    await expect(service.remove('user-1', 'card-1')).resolves.toMatchObject({
      id: 'card-1',
    });
    expect(repository.softDeleteForUser).toHaveBeenCalledWith(
      'user-1',
      'card-1',
      expect.any(Date),
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'storyboard-audio/card-1/old.webm',
    );
    expect(repository.scheduleAudioCleanup).toHaveBeenCalledWith(
      'card-1',
      'storyboard-audio/card-1/old.webm',
    );

    repository.findByIdForUser.mockResolvedValue(null);
    await expect(service.remove('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Storyboard card not found'),
    );
    repository.findByIdForUser.mockResolvedValue(card);
    repository.softDeleteForUser.mockResolvedValue(null);
    await expect(service.remove('user-1', 'card-1')).rejects.toThrow(
      new NotFoundException('Storyboard card not found'),
    );

    repository.findByIdForUser.mockResolvedValue({
      ...card,
      audioStorageKey: 'old-key',
    });
    repository.softDeleteForUser.mockResolvedValue({
      ...card,
      audioStorageKey: 'new-key',
    });
    storage.deleteObject.mockResolvedValue(undefined);
    await service.remove('user-1', 'card-1');
    expect(storage.deleteObject).toHaveBeenCalledWith('new-key');
    expect(storage.deleteObject).toHaveBeenCalledWith('old-key');
  });

  it('attaches only a present audio file owned by the card and cleans up replaced audio', async () => {
    repository.findByIdForUser.mockResolvedValue({
      ...card,
      audioStorageKey: 'storyboard-audio/card-1/old.webm',
    });
    const dto = {
      audioStorageKey: 'storyboard-audio/card-1/new.webm',
      audioDurationSecs: 13,
    };
    storage.headFile.mockResolvedValue(true);
    repository.attachAudioForUser.mockResolvedValue({
      ...card,
      audioStorageKey: dto.audioStorageKey,
    });
    storage.deleteObject.mockResolvedValue(undefined);

    await expect(
      service.attachAudio('user-1', 'card-1', dto),
    ).resolves.toMatchObject({ audioStorageKey: dto.audioStorageKey });
    expect(repository.attachAudioForUser).toHaveBeenCalledWith(
      'user-1',
      'card-1',
      dto.audioStorageKey,
      13,
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'storyboard-audio/card-1/old.webm',
    );

    await expect(
      service.attachAudio('user-1', 'card-1', {
        ...dto,
        audioStorageKey: 'scenes/card-1/audio.webm',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.attachAudio('user-1', 'card-1', {
        ...dto,
        audioStorageKey: 'storyboard-audio/card-1/sub/new.webm',
      }),
    ).rejects.toThrow(BadRequestException);
    storage.headFile.mockResolvedValue(false);
    await expect(service.attachAudio('user-1', 'card-1', dto)).rejects.toThrow(
      new BadRequestException('El archivo de audio no se encontró en R2.'),
    );
    repository.findByIdForUser.mockResolvedValue(null);
    await expect(service.attachAudio('user-1', 'missing', dto)).rejects.toThrow(
      new NotFoundException('Storyboard card not found'),
    );
  });

  it('loads signed audio URLs and rejects cards without audio', async () => {
    repository.findByIdForUser.mockResolvedValue({
      ...card,
      audioStorageKey: 'storyboard-audio/card-1/audio.webm',
    });
    storage.generatePresignedGetUrl.mockResolvedValue(
      'https://signed.example/audio',
    );
    await expect(service.getAudioUrl('user-1', 'card-1')).resolves.toBe(
      'https://signed.example/audio',
    );
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      'storyboard-audio/card-1/audio.webm',
    );
    repository.findByIdForUser.mockResolvedValue(card);
    await expect(service.getAudioUrl('user-1', 'card-1')).rejects.toThrow(
      new NotFoundException('Storyboard card has no audio'),
    );
    repository.findByIdForUser.mockResolvedValue(null);
    await expect(service.getAudioUrl('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Storyboard card not found'),
    );
  });
});

describe('StoryboardMatrixService', () => {
  const project = { findFirst: jest.fn() };
  const entity = { findFirst: jest.fn() };
  const relationship = { findFirst: jest.fn() };
  const chapter = { findFirst: jest.fn() };
  let queryRaw: jest.Mock;
  let executeRaw: jest.Mock;
  let service: StoryboardMatrixService;

  beforeEach(() => {
    queryRaw = jest.fn();
    executeRaw = jest.fn();
    const prisma = {
      project,
      entity,
      relationship,
      chapter,
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    };
    service = new StoryboardMatrixService(prisma as never);
    project.findFirst.mockReset().mockResolvedValue({ id: 'project-1' });
    entity.findFirst.mockReset();
    relationship.findFirst.mockReset();
    chapter.findFirst.mockReset();
  });

  it('lists arcs with their notes and avoids a notes query when the project is empty', async () => {
    const arc = { id: 'arc-1', projectId: 'project-1', title: 'Arc' };
    const note = { id: 'note-1', arcId: 'arc-1', content: 'Beat' };
    queryRaw.mockResolvedValueOnce([arc]).mockResolvedValueOnce([note]);
    await expect(service.listArcs('user-1', 'project-1')).resolves.toEqual([
      { ...arc, notes: [note] },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(2);

    queryRaw.mockReset().mockResolvedValueOnce([]);
    await expect(service.listArcs('user-1', 'project-1')).resolves.toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    project.findFirst.mockResolvedValue(null);
    await expect(service.listArcs('user-1', 'project-1')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
  });

  it('creates custom, entity-linked, and relationship-linked arcs with the next sort key', async () => {
    const arc = { id: 'arc-1', projectId: 'project-1', notes: [] };
    queryRaw
      .mockResolvedValueOnce([{ count: 5n }])
      .mockResolvedValueOnce([arc]);
    await expect(
      service.createArc('user-1', 'project-1', {
        title: 'Custom',
        sourceType: 'custom',
        customType: '  Inner  ',
      } as never),
    ).resolves.toEqual(arc);
    const arcInsertCall = queryRaw.mock.calls[1] as unknown as unknown[];
    expect(arcInsertCall[4]).toBe('Inner');
    expect(arcInsertCall[7]).toBe('000006');

    entity.findFirst.mockResolvedValue({ id: 'entity-1' });
    queryRaw
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([arc]);
    await service.createArc('user-1', 'project-1', {
      title: 'Entity',
      sourceType: 'entity',
      entityId: 'entity-1',
    } as never);
    expect(entity.findFirst).toHaveBeenCalledWith({
      where: { id: 'entity-1', projectId: 'project-1', deletedAt: null },
      select: { id: true },
    });

    relationship.findFirst.mockResolvedValue({ id: 'relationship-1' });
    queryRaw
      .mockResolvedValueOnce([{ count: 1n }])
      .mockResolvedValueOnce([arc]);
    await service.createArc('user-1', 'project-1', {
      title: 'Relationship',
      sourceType: 'relationship',
      relationshipId: 'relationship-1',
    } as never);
    expect(relationship.findFirst).toHaveBeenCalledWith({
      where: { id: 'relationship-1', projectId: 'project-1' },
      select: { id: true },
    });
  });

  it('rejects missing arc sources and missing insert results', async () => {
    entity.findFirst.mockResolvedValue(null);
    await expect(
      service.createArc('user-1', 'project-1', {
        title: 'No source',
        sourceType: 'entity',
        entityId: 'missing',
      } as never),
    ).rejects.toThrow(new NotFoundException('Arc source not found'));
    project.findFirst.mockResolvedValue(null);
    await expect(
      service.createArc('user-1', 'missing', {
        title: 'Custom',
        sourceType: 'custom',
      } as never),
    ).rejects.toThrow(new NotFoundException('Project not found'));
    project.findFirst.mockResolvedValue({ id: 'project-1' });
    queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);
    await expect(
      service.createArc('user-1', 'project-1', {
        title: 'Empty',
        sourceType: 'custom',
      } as never),
    ).rejects.toThrow(new NotFoundException('Storyboard arc not found'));
  });

  it('soft deletes arcs and matrix notes only when the owned row exists', async () => {
    executeRaw.mockResolvedValue(1);
    await expect(service.removeArc('user-1', 'arc-1')).resolves.toBeUndefined();
    await expect(
      service.removeNote('user-1', 'note-1'),
    ).resolves.toBeUndefined();
    executeRaw.mockResolvedValue(0);
    await expect(service.removeArc('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Storyboard arc not found'),
    );
    await expect(service.removeNote('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Matrix note not found'),
    );
  });

  it('creates notes for a user-owned arc and chapter and calculates the next position', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: 'arc-1', projectId: 'project-1' }])
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([
        { id: 'note-1', arcId: 'arc-1', chapterId: 'chapter-1' },
      ]);
    chapter.findFirst.mockResolvedValue({ id: 'chapter-1' });
    await expect(
      service.createNote('user-1', 'arc-1', {
        chapterId: 'chapter-1',
        content: 'Beat',
      }),
    ).resolves.toMatchObject({ id: 'note-1' });
    expect(chapter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'chapter-1',
        deletedAt: null,
        book: { projectId: 'project-1' },
      },
      select: { id: true },
    });

    queryRaw.mockReset().mockResolvedValueOnce([]);
    await expect(
      service.createNote('user-1', 'missing', {
        chapterId: 'chapter-1',
        content: 'Beat',
      }),
    ).rejects.toThrow(new NotFoundException('Storyboard arc not found'));
    queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'arc-1', projectId: 'project-1' }]);
    chapter.findFirst.mockResolvedValue(null);
    await expect(
      service.createNote('user-1', 'arc-1', {
        chapterId: 'missing',
        content: 'Beat',
      }),
    ).rejects.toThrow(new NotFoundException('Chapter not found'));
    chapter.findFirst.mockResolvedValue({ id: 'chapter-1' });
    queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'arc-1', projectId: 'project-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(
      service.createNote('user-1', 'arc-1', {
        chapterId: 'chapter-1',
        content: 'Beat',
      }),
    ).rejects.toThrow(new NotFoundException('Matrix note not found'));
  });

  it('updates an owned note and reports a note that is absent or outside the project', async () => {
    const note = {
      id: 'note-1',
      arcId: 'arc-1',
      chapterId: 'chapter-1',
      content: 'Changed',
    };
    queryRaw.mockResolvedValueOnce([note]);
    await expect(
      service.updateNote('user-1', 'note-1', { content: 'Changed' }),
    ).resolves.toEqual(note);
    queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.updateNote('user-1', 'missing', { content: 'Changed' }),
    ).rejects.toThrow(new NotFoundException('Matrix note not found'));
  });
});
