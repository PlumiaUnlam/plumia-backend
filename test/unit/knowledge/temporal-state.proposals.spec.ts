import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProposalStatus } from '@prisma/client';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  type TemporalStateInternals,
  stateTransaction,
  state,
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

  it('rejects missing proposals and records author rejections', async () => {
    prisma.entityStateProposal.findFirst.mockResolvedValueOnce(null);
    await expect(service.rejectProposal('user-one', 'missing')).rejects.toThrow(
      NotFoundException,
    );

    prisma.entityStateProposal.findFirst.mockResolvedValueOnce({
      projectId: 'project-one',
    });
    prisma.entityStateProposal.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      service.rejectProposal('user-one', 'proposal-one'),
    ).resolves.toBeUndefined();
    expect(prisma.entityStateProposal.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ProposalStatus.REJECTED,
        }) as unknown,
      }),
    );
  });

  it('reconstructs a temporal view without exposing future states or relationships', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-one' });
    snapshots.getSnapshot.mockResolvedValue({
      projectId: 'project-one',
      entities: [{ id: 'entity-one', canonicalName: 'Elena' }],
      activeStates: [
        { entityId: 'entity-one', attributeKey: 'location', toValue: 'Tower' },
      ],
      activeRelationships: [{ id: 'relationship-one' }],
    });
    jest.spyOn(internals, 'getOrderedScenes').mockResolvedValue([
      { id: 'scene-one', title: 'One' },
      { id: 'scene-two', title: 'Two' },
    ]);

    await expect(
      service.getTemporalView('user-one', 'project-one', 'scene-two'),
    ).resolves.toEqual({
      sceneId: 'scene-two',
      scenes: [
        { id: 'scene-one', title: 'One' },
        { id: 'scene-two', title: 'Two' },
      ],
      entities: [
        {
          id: 'entity-one',
          canonicalName: 'Elena',
          dynamicStates: [{ key: 'location', value: 'Tower' }],
        },
      ],
      relationships: [{ id: 'relationship-one' }],
    });
  });

  it('validates relationship and state temporal windows', async () => {
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);

    await expect(
      service.validateRelationshipWindow(
        'project-one',
        'scene-two',
        'scene-one',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.validateRelationshipWindow('project-one', 'foreign-scene', null),
    ).rejects.toThrow(BadRequestException);
    expect(() =>
      internals.assertWindow(positions, 'scene-two', 'scene-two'),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.assertWindow(positions, 'foreign-scene', null),
    ).toThrow(BadRequestException);
  });

  it('allows a non-temporal relationship audit to be skipped', async () => {
    await service.scheduleRelationshipAudit('project-one', null);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('enqueues temporal audits from the changed scene onward', async () => {
    const tx = stateTransaction([]);
    jest.spyOn(internals, 'getOrderedScenes').mockResolvedValue([
      { id: 'scene-one', title: 'One' },
      { id: 'scene-two', title: 'Two' },
      { id: 'scene-three', title: 'Three' },
    ]);

    await internals.enqueueTemporalAudit(
      tx,
      'project-one',
      'scene-two',
      positions,
    );

    expect(tx.outbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ aggregateId: 'scene-two' }) as unknown,
        expect.objectContaining({ aggregateId: 'scene-three' }) as unknown,
      ],
    });
  });

  it('prevents overlapping standard states but leaves custom attributes unconstrained', async () => {
    const tx = stateTransaction([
      state('one', 'location', 'port', 'scene-one', 'scene-three'),
      state('two', 'location', 'tower', 'scene-two', null),
    ]);
    await expect(
      internals.assertNoStandardOverlaps(tx, 'entity-one', positions),
    ).rejects.toThrow(BadRequestException);

    tx.entityState.findMany.mockResolvedValue([
      state('one', 'location', 'port', 'scene-two', null, 0),
      state('two', 'location', 'river', 'scene-two', null, 1000),
    ]);
    await expect(
      internals.assertNoStandardOverlaps(tx, 'entity-one', positions),
    ).resolves.toBeUndefined();

    tx.entityState.findMany.mockResolvedValue([
      state('one', 'weapon', 'sword', 'scene-one', null),
      state('two', 'weapon', 'staff', 'scene-two', null),
    ]);
    await expect(
      internals.assertNoStandardOverlaps(tx, 'entity-one', positions),
    ).resolves.toBeUndefined();
  });

  it('locks an authored state key once without duplicating it', async () => {
    const tx = stateTransaction([]);
    tx.entity.findUnique.mockResolvedValue({ userLockedFields: [] });
    await internals.lockStateKey(tx, 'entity-one', 'Health Status');
    expect(tx.entity.update).toHaveBeenCalledWith({
      where: { id: 'entity-one' },
      data: { userLockedFields: ['state:health_status'] },
    });

    tx.entity.findUnique.mockResolvedValue({
      userLockedFields: ['state:health_status'],
    });
    await internals.lockStateKey(tx, 'entity-one', 'health_status');
    expect(tx.entity.update).toHaveBeenCalledTimes(1);
  });
});
