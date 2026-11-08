import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  type TemporalStateInternals,
  setupTransaction,
  stateTransaction,
  state,
  stateRecord,
  stateChange,
  proposalInput,
} from './temporal-state.fixtures';

describe('TemporalStateService', () => {
  const prisma = {
    $transaction: jest.fn(),
    entity: { findFirst: jest.fn() },
    entityState: { findFirst: jest.fn(), findMany: jest.fn() },
    entityStateProposal: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    project: { findFirst: jest.fn() },
    scene: { findMany: jest.fn() },
    projectKnowledgeReviewSettings: {
      findUnique: jest.fn().mockResolvedValue({ stateTrackingEnabled: true }),
    },
  };

  const snapshots = { getSnapshot: jest.fn() };

  const service = new TemporalStateService(
    prisma as unknown as PrismaService,
    snapshots as unknown as TemporalKnowledgeSnapshotService,
  );

  const internals = service as unknown as TemporalStateInternals;

  const positions = new Map([
    ['scene-one', 0],
    ['scene-two', 1],
    ['scene-three', 2],
  ]);

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-one' });
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateTrackingEnabled: true,
    });
  });

  it('closes the active standard state when a new value begins', async () => {
    const tx = stateTransaction([
      state('state-living', 'status', 'alive', 'scene-one', null),
    ]);
    tx.entityState.create.mockResolvedValue({ id: 'state-dead' });

    await internals.applyStateChange(
      tx,
      stateChange({
        attributeKey: 'status',
        toValue: 'dead',
        validFromSceneId: 'scene-two',
      }),
    );

    expect(tx.entityState.update).toHaveBeenCalledWith({
      where: { id: 'state-living' },
      data: { validToSceneId: 'scene-two' },
    });
    expect(tx.entityState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributeKey: 'status',
          fromValue: 'alive',
          toValue: 'dead',
          validFromSceneId: 'scene-two',
        }) as unknown,
      }),
    );
  });

  it('updates the standard state that begins in the same scene', async () => {
    const tx = stateTransaction([
      state('state-same-scene', 'location', 'port', 'scene-two', null),
    ]);
    tx.entityState.update.mockResolvedValue({ id: 'state-same-scene' });

    await internals.applyStateChange(
      tx,
      stateChange({ attributeKey: 'location', toValue: 'tower' }),
    );

    expect(tx.entityState.create).not.toHaveBeenCalled();
    expect(tx.entityState.update).toHaveBeenCalledWith({
      where: { id: 'state-same-scene' },
      data: {
        toValue: 'tower',
        validToSceneId: null,
        source: 'author_manual',
      },
    });
  });

  it('stores ordered transitions in the same scene without closing a state at its start', async () => {
    const tx = stateTransaction([
      state('state-first-step', 'location', 'port', 'scene-two', null, 0),
    ]);
    tx.entityState.create.mockResolvedValue({ id: 'state-second-step' });

    await internals.applyStateChange(tx, {
      ...stateChange({
        attributeKey: 'location',
        toValue: 'river',
        validFromSceneId: 'scene-two',
      }),
      narrativeOrder: 1000,
    });

    expect(tx.entityState.update).not.toHaveBeenCalled();
    expect(tx.entityState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromValue: 'port',
          toValue: 'river',
          validFromSceneId: 'scene-two',
          validToSceneId: null,
          narrativeOrder: 1000,
        }) as unknown,
      }),
    );
  });

  it('allows custom states to coexist without closing a previous value', async () => {
    const tx = stateTransaction([
      state('state-sword', 'weapon', 'sword', 'scene-one', null),
    ]);
    tx.entityState.create.mockResolvedValue({ id: 'state-shield' });

    await internals.applyStateChange(
      tx,
      stateChange({
        attributeKey: 'weapon',
        toValue: 'shield',
        validFromSceneId: 'scene-two',
      }),
    );

    expect(tx.entityState.update).not.toHaveBeenCalled();
    expect(tx.entityState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromValue: 'sword' }) as unknown,
      }),
    );
  });

  it('rejects incomplete state changes before persisting them', async () => {
    const tx = stateTransaction([]);

    await expect(
      internals.applyStateChange(
        tx,
        stateChange({ attributeKey: '   ', toValue: ' ' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists only states of an entity the author can access', async () => {
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-one',
      projectId: 'project-one',
    });
    prisma.entityState.findMany.mockResolvedValue([stateRecord()]);

    await expect(service.listStates('user-one', 'entity-one')).resolves.toEqual(
      [stateRecord()],
    );
    expect(prisma.entityState.findMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-one' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('lists all approved state history for an owned project in narrative order', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-one' });
    const sceneRecord = (
      id: string,
      title: string,
    ): {
      id: string;
      title: string;
      chapter: { title: string; book: { title: string } };
    } => ({
      id,
      title,
      chapter: { title: 'Chapter', book: { title: 'Book' } },
    });
    prisma.entityState.findMany.mockResolvedValue([
      {
        ...stateRecord({
          id: 'state-later',
          validFromSceneId: 'scene-three',
          narrativeOrder: 100,
          toValue: 'Tower',
        }),
        entity: { canonicalName: 'Elena' },
        validFromScene: sceneRecord('scene-three', 'The tower'),
        validToScene: null,
      },
      {
        ...stateRecord({
          id: 'state-earlier',
          validFromSceneId: 'scene-one',
          narrativeOrder: 0,
          toValue: 'Port',
        }),
        entity: { canonicalName: 'Elena' },
        validFromScene: sceneRecord('scene-one', 'The harbor'),
        validToScene: sceneRecord('scene-three', 'The tower'),
      },
    ]);
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);

    const history = await service.listProjectStateHistory(
      'user-one',
      'project-one',
    );

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-one', userId: 'user-one', deletedAt: null },
      select: { id: true },
    });
    expect(history.map((state) => state.id)).toEqual([
      'state-earlier',
      'state-later',
    ]);
    expect(history[0]).toMatchObject({
      entityName: 'Elena',
      fromValue: 'alive',
      toValue: 'Port',
      validFromScene: {
        title: 'The harbor',
        chapterTitle: 'Chapter',
        bookTitle: 'Book',
      },
      validToScene: {
        title: 'The tower',
      },
    });
  });

  it('does not expose state history for another author project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.listProjectStateHistory('user-one', 'project-one'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.entityState.findMany).not.toHaveBeenCalled();
  });

  it('creates a manual state, locks its key, and audits subsequent scenes', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-one',
      projectId: 'project-one',
    });
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);
    const apply = jest
      .spyOn(internals, 'applyStateChange')
      .mockResolvedValue(stateRecord());
    const lock = jest.spyOn(internals, 'lockStateKey').mockResolvedValue();
    const enqueue = jest
      .spyOn(internals, 'enqueueTemporalAudit')
      .mockResolvedValue();

    const result = await service.createState('user-one', 'entity-one', {
      attributeKey: ' Location ',
      toValue: 'Tower',
      validFromSceneId: 'scene-two',
    });

    expect(result.attributeKey).toBe('status');
    expect(apply).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ source: 'author_manual' }),
    );
    expect(lock).toHaveBeenCalledWith(tx, 'entity-one', ' Location ');
    expect(enqueue).toHaveBeenCalledWith(
      tx,
      'project-one',
      'scene-two',
      positions,
    );
  });

  it('updates and deletes states only when they belong to the current author', async () => {
    const existing = {
      ...stateRecord(),
      entity: { projectId: 'project-one' },
    };
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    prisma.entityState.findFirst.mockResolvedValue(existing);
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);
    jest.spyOn(internals, 'assertNoStandardOverlaps').mockResolvedValue();
    jest.spyOn(internals, 'lockStateKey').mockResolvedValue();
    jest.spyOn(internals, 'enqueueTemporalAudit').mockResolvedValue();
    tx.entityState.update.mockResolvedValue({
      ...stateRecord(),
      toValue: 'alive',
    });

    await expect(
      service.updateState('user-one', 'state-one', { toValue: 'alive' }),
    ).resolves.toMatchObject({ toValue: 'alive' });
    expect(tx.entityState.update).toHaveBeenCalledWith({
      where: { id: 'state-one' },
      data: {
        attributeKey: 'status',
        validFromSceneId: 'scene-two',
        validToSceneId: null,
        toValue: 'alive',
      },
    });

    await service.removeState('user-one', 'state-one');
    expect(tx.entityState.delete).toHaveBeenCalledWith({
      where: { id: 'state-one' },
    });
  });

  it('returns not found when a state does not belong to the author', async () => {
    prisma.entityState.findFirst.mockResolvedValue(null);

    await expect(
      service.updateState('user-one', 'missing', { toValue: 'alive' }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.removeState('user-one', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates a locked state proposal with normalized input and evidence', async () => {
    prisma.entity.findFirst.mockResolvedValue({
      userLockedFields: ['state:location'],
    });
    prisma.entityStateProposal.findFirst.mockResolvedValue(null);

    await service.createProposal(proposalInput());

    expect(prisma.entityStateProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attributeKey: 'location',
        evidence: ['Elena llega a la torre.'],
        conflictsWithLocked: true,
      }) as unknown,
    });
  });
});
