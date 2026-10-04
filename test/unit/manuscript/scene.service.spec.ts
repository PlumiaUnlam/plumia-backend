import { NotFoundException } from '@nestjs/common';
import { type AnalyticsService } from '../../../src/analytics/analytics.service';
import { SceneStatus } from '../../../src/manuscript/domain/scene-status';
import type {
  SceneContentUpdateResult,
  SceneRecord,
  SceneRepository,
  SceneVersionRecord,
} from '../../../src/manuscript/ports/scene-repository.port';
import { SceneService } from '../../../src/manuscript/services/scene.service';

describe('SceneService', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const scene: SceneRecord = {
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
    deletedAt: null,
  };
  const version: SceneVersionRecord = {
    id: 'version-1',
    sceneId: 'scene-1',
    label: 'Draft',
    content: { type: 'doc' },
    contentHash: 'version-hash',
    wordCount: 12,
    createdFromId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  let repository: jest.Mocked<SceneRepository>;
  let analytics: { recordSceneSave: jest.Mock };
  let service: SceneService;

  beforeEach(() => {
    repository = {
      createForUser: jest.fn(),
      findByIdForUser: jest.fn(),
      updateForUser: jest.fn(),
      updateContentForUser: jest.fn(),
      listVersionsForUser: jest.fn(),
      createVersionForUser: jest.fn(),
      findVersionForUser: jest.fn(),
      updateVersionContentForUser: jest.fn(),
      updateVersionForUser: jest.fn(),
      softDeleteVersionForUser: jest.fn(),
      restoreVersionForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
    };
    analytics = { recordSceneSave: jest.fn().mockResolvedValue(undefined) };
    service = new SceneService(
      repository,
      analytics as unknown as AnalyticsService,
    );
  });

  it('creates only the provided scene fields and reports missing chapters', async () => {
    repository.createForUser.mockResolvedValue(scene);
    await expect(
      service.create('user-1', 'chapter-1', { sortKey: '001' }),
    ).resolves.toEqual(scene);
    expect(repository.createForUser).toHaveBeenCalledWith('user-1', {
      chapterId: 'chapter-1',
      sortKey: '001',
    });

    const dto = {
      sortKey: '002',
      title: 'Next',
      content: { type: 'doc' },
      wordCount: 40,
      status: SceneStatus.IN_PROGRESS,
      order: 1,
    };
    await service.create('user-1', 'chapter-1', dto);
    expect(repository.createForUser).toHaveBeenLastCalledWith('user-1', {
      chapterId: 'chapter-1',
      ...dto,
    });
    repository.createForUser.mockResolvedValue(null);
    await expect(
      service.create('user-1', 'missing', { sortKey: '001' }),
    ).rejects.toThrow(new NotFoundException('Chapter not found'));
  });

  it('loads, updates, and deletes scenes with clear not-found behavior', async () => {
    repository.findByIdForUser.mockResolvedValue(scene);
    await expect(service.getById('user-1', 'scene-1')).resolves.toEqual(scene);
    expect(repository.findByIdForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
    );
    repository.updateForUser.mockResolvedValue(scene);
    await expect(
      service.update('user-1', 'scene-1', { title: 'Updated' }),
    ).resolves.toEqual(scene);
    expect(repository.updateForUser).toHaveBeenCalledWith('user-1', 'scene-1', {
      title: 'Updated',
    });
    repository.softDeleteForUser.mockResolvedValue({
      ...scene,
      deletedAt: now,
    });
    await expect(service.remove('user-1', 'scene-1')).resolves.toMatchObject({
      deletedAt: now,
    });
    expect(repository.softDeleteForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      expect.any(Date),
    );

    repository.findByIdForUser.mockResolvedValue(null);
    repository.updateForUser.mockResolvedValue(null);
    repository.softDeleteForUser.mockResolvedValue(null);
    await expect(service.getById('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Scene not found'),
    );
    await expect(service.update('user-1', 'missing', {})).rejects.toThrow(
      new NotFoundException('Scene not found'),
    );
    await expect(service.remove('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Scene not found'),
    );
  });

  it('records analytics only when saved scene content actually changes', async () => {
    const changed: SceneContentUpdateResult = {
      scene,
      contentChanged: true,
      previousWordCount: 10,
    };
    repository.updateContentForUser.mockResolvedValue(changed);
    await expect(
      service.updateContent('user-1', 'scene-1', {
        content: { type: 'doc' },
        wordCount: 12,
      }),
    ).resolves.toEqual(changed);
    expect(analytics.recordSceneSave).toHaveBeenCalledWith({
      userId: 'user-1',
      sceneId: 'scene-1',
      previousWordCount: 10,
      currentWordCount: 12,
    });

    repository.updateContentForUser.mockResolvedValue({
      ...changed,
      contentChanged: false,
    });
    await service.updateContent('user-1', 'scene-1', {
      content: { type: 'doc' },
    });
    expect(analytics.recordSceneSave).toHaveBeenCalledTimes(1);
    repository.updateContentForUser.mockResolvedValue(null);
    await expect(
      service.updateContent('user-1', 'missing', { content: { type: 'doc' } }),
    ).rejects.toThrow(new NotFoundException('Scene not found'));
  });

  it('creates, lists, and retrieves scene versions', async () => {
    repository.listVersionsForUser.mockResolvedValue([version]);
    await expect(service.listVersions('user-1', 'scene-1')).resolves.toEqual([
      version,
    ]);
    repository.listVersionsForUser.mockResolvedValue(null);
    await expect(service.listVersions('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Scene not found'),
    );

    repository.createVersionForUser.mockResolvedValue(version);
    const content = { type: 'doc', content: [] };
    await expect(
      service.createVersion('user-1', 'scene-1', {
        label: 'Snapshot',
        content,
        wordCount: 5,
      }),
    ).resolves.toEqual(version);
    expect(repository.createVersionForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'Snapshot',
      content,
      5,
    );
    repository.createVersionForUser.mockResolvedValue(null);
    await expect(
      service.createVersion('user-1', 'missing', {}),
    ).rejects.toThrow(new NotFoundException('Scene not found'));

    repository.findVersionForUser.mockResolvedValue(version);
    await expect(
      service.getVersion('user-1', 'scene-1', 'version-1'),
    ).resolves.toEqual(version);
    repository.findVersionForUser.mockResolvedValue(null);
    await expect(
      service.getVersion('user-1', 'scene-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Scene version not found'));
  });

  it('updates version content and metadata, normalizing blank labels to null', async () => {
    const contentResult = { version, contentChanged: true };
    repository.updateVersionContentForUser.mockResolvedValue(contentResult);
    await expect(
      service.updateVersionContent('user-1', 'scene-1', 'version-1', {
        content: { type: 'doc' },
      }),
    ).resolves.toEqual(contentResult);
    expect(repository.updateVersionContentForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
      { content: { type: 'doc' } },
    );
    repository.updateVersionContentForUser.mockResolvedValue(null);
    await expect(
      service.updateVersionContent('user-1', 'scene-1', 'missing', {
        content: { type: 'doc' },
      }),
    ).rejects.toThrow(new NotFoundException('Scene version not found'));

    repository.updateVersionForUser.mockResolvedValue(version);
    await service.updateVersion('user-1', 'scene-1', 'version-1', {
      label: '',
    });
    expect(repository.updateVersionForUser).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'scene-1',
      'version-1',
      { label: null },
    );
    await service.updateVersion('user-1', 'scene-1', 'version-1', {});
    expect(repository.updateVersionForUser).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'scene-1',
      'version-1',
      {},
    );
    repository.updateVersionForUser.mockResolvedValue(null);
    await expect(
      service.updateVersion('user-1', 'scene-1', 'missing', {}),
    ).rejects.toThrow(new NotFoundException('Scene version not found'));
  });

  it('soft deletes and restores scene versions', async () => {
    repository.softDeleteVersionForUser.mockResolvedValue({
      ...version,
      deletedAt: now,
    });
    await expect(
      service.removeVersion('user-1', 'scene-1', 'version-1'),
    ).resolves.toMatchObject({ deletedAt: now });
    expect(repository.softDeleteVersionForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
      expect.any(Date),
    );
    repository.softDeleteVersionForUser.mockResolvedValue(null);
    await expect(
      service.removeVersion('user-1', 'scene-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Scene version not found'));

    const restored = { scene, contentChanged: true, previousWordCount: 12 };
    repository.restoreVersionForUser.mockResolvedValue(restored);
    await expect(
      service.restoreVersion('user-1', 'scene-1', 'version-1'),
    ).resolves.toEqual(restored);
    expect(repository.restoreVersionForUser).toHaveBeenCalledWith(
      'user-1',
      'scene-1',
      'version-1',
    );
    repository.restoreVersionForUser.mockResolvedValue(null);
    await expect(
      service.restoreVersion('user-1', 'scene-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Scene version not found'));
  });
});
