import type { PrismaService } from '../../../../src/prisma/prisma.service';
import { PrismaSceneRepository } from '../../../../src/manuscript/adapters/prisma-scene-repository.adapter';

describe('PrismaSceneRepository analysis status', () => {
  const sceneFindFirst = jest.fn();
  const outboxFindFirst = jest.fn();
  const repository = new PrismaSceneRepository({
    scene: { findFirst: sceneFindFirst },
    outbox: { findFirst: outboxFindFirst },
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the latest event state for an authorized scene', async () => {
    sceneFindFirst.mockResolvedValue({ id: 'scene-1' });
    outboxFindFirst.mockResolvedValue({
      payload: {
        analysisStatus: 'FAILED',
        analysisError: 'The model request failed.',
      },
      processedAt: new Date(),
    });

    await expect(
      repository.getAnalysisStatusForUser('user-1', 'scene-1'),
    ).resolves.toEqual({
      status: 'FAILED',
      error: 'The model request failed.',
    });
    expect(outboxFindFirst).toHaveBeenCalledWith({
      where: {
        aggregateType: 'Scene',
        aggregateId: 'scene-1',
        eventType: 'scene_changed',
      },
      orderBy: { createdAt: 'desc' },
      select: { payload: true, processedAt: true },
    });
  });

  it('reports no changes when no analysis event exists', async () => {
    sceneFindFirst.mockResolvedValue({ id: 'scene-1' });
    outboxFindFirst.mockResolvedValue(null);

    await expect(
      repository.getAnalysisStatusForUser('user-1', 'scene-1'),
    ).resolves.toEqual({ status: 'NO_CHANGES', error: null });
  });

  it('does not reveal the status of a scene owned by another user', async () => {
    sceneFindFirst.mockResolvedValue(null);

    await expect(
      repository.getAnalysisStatusForUser('user-1', 'scene-2'),
    ).resolves.toBeNull();
    expect(outboxFindFirst).not.toHaveBeenCalled();
  });
});
