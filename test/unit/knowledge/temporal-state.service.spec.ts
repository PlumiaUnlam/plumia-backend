import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProposalStatus } from '@prisma/client';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

interface StateChangeInput {
  entityId: string;
  projectId: string;
  attributeKey: string;
  toValue: string;
  validFromSceneId: string;
  validToSceneId: string | null;
  source: string;
  positions: ReadonlyMap<string, number>;
}

interface StateRecord {
  id: string;
  entityId: string;
  attributeKey: string;
  fromValue: string | null;
  toValue: string;
  validFromSceneId: string;
  validToSceneId: string | null;
  narrativeOrder: number | null;
  source: string;
  createdAt: Date;
}

interface StateTransaction {
  chunk: { findFirst: jest.Mock; findMany: jest.Mock };
  entity: { findUnique: jest.Mock; update: jest.Mock };
  entityState: {
    create: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  entityStateProposal: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  outbox: { createMany: jest.Mock };
  scene: { findMany: jest.Mock };
}

interface TransactionRunner {
  $transaction: jest.Mock;
}

interface TemporalStateInternals {
  applyStateChange: (
    tx: StateTransaction,
    input: StateChangeInput & { narrativeOrder?: number },
  ) => Promise<unknown>;
  assertNoStandardOverlaps: (
    tx: StateTransaction,
    entityId: string,
    positions: ReadonlyMap<string, number>,
  ) => Promise<void>;
  assertWindow: (
    positions: ReadonlyMap<string, number>,
    fromSceneId: string,
    toSceneId: string | null | undefined,
  ) => void;
  enqueueTemporalAudit: (
    tx: StateTransaction,
    projectId: string,
    fromSceneId: string,
    positions: ReadonlyMap<string, number>,
  ) => Promise<void>;
  getOrderedScenes: (
    client: { scene: { findMany: jest.Mock } },
    projectId: string,
  ) => Promise<Array<{ id: string; title: string | null }>>;
  getScenePositions: (
    client: unknown,
    projectId: string,
  ) => Promise<Map<string, number>>;
  lockStateKey: (
    tx: StateTransaction,
    entityId: string,
    attributeKey: string,
  ) => Promise<void>;
}

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
    const sceneRecord = (id: string, title: string) => ({
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
      data: { toValue: 'alive' },
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

  it('accepts a state sequence in narrative order and validates current evidence', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    tx.entityStateProposal.findMany.mockResolvedValue([
      stateProposalRecord({
        id: 'proposal-later',
        sceneId: 'scene-three',
        sourceChunkId: 'chunk-later',
        sourceChunkHash: 'hash-later',
        narrativeOrder: 1200,
      }),
      stateProposalRecord({
        id: 'proposal-earlier',
        sceneId: 'scene-one',
        sourceChunkId: 'chunk-earlier',
        sourceChunkHash: 'hash-earlier',
        narrativeOrder: 300,
      }),
    ]);
    tx.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-later',
        sceneId: 'scene-three',
        contentHash: 'hash-later',
        isDirty: false,
      },
      {
        id: 'chunk-earlier',
        sceneId: 'scene-one',
        contentHash: 'hash-earlier',
        isDirty: false,
      },
    ]);
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);
    const apply = jest
      .spyOn(internals, 'applyStateChange')
      .mockResolvedValue(stateRecord());
    jest.spyOn(internals, 'enqueueTemporalAudit').mockResolvedValue();

    await service.acceptProposalSequence('user-one', 'project-one', {
      acceptedProposalIds: ['proposal-later', 'proposal-earlier'],
      rejectedProposalIds: [],
    });

    expect(apply.mock.calls.map(([, input]) => input.validFromSceneId)).toEqual(
      ['scene-one', 'scene-three'],
    );
    expect(tx.entityStateProposal.update).toHaveBeenCalledTimes(2);
    expect(tx.chunk.findMany).toHaveBeenCalled();
  });

  it('marks stale sequence evidence obsolete without applying any state', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    tx.entityStateProposal.findMany.mockResolvedValue([
      stateProposalRecord({ sourceChunkHash: 'old-hash' }),
    ]);
    tx.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-one',
        sceneId: 'scene-two',
        contentHash: 'new-hash',
        isDirty: false,
      },
    ]);
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);
    const apply = jest.spyOn(internals, 'applyStateChange');

    await expect(
      service.acceptProposalSequence('user-one', 'project-one', {
        acceptedProposalIds: ['proposal-one'],
        rejectedProposalIds: [],
      }),
    ).rejects.toThrow('Algunas propuestas quedaron obsoletas');

    expect(tx.entityStateProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['proposal-one'] } },
      data: { status: ProposalStatus.OBSOLETE },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('blocks incompatible same-scene values unless they are explicit transitions', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    tx.entityStateProposal.findMany.mockResolvedValue([
      stateProposalRecord({
        id: 'proposal-one',
        toValue: 'Puerto',
        sequenceKind: 'CONTRADICTION',
      }),
      stateProposalRecord({
        id: 'proposal-two',
        toValue: 'Torre',
        sequenceKind: 'CONTRADICTION',
      }),
    ]);
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);

    await expect(
      service.acceptProposalSequence('user-one', 'project-one', {
        acceptedProposalIds: ['proposal-one', 'proposal-two'],
        rejectedProposalIds: [],
      }),
    ).rejects.toThrow('Hay valores incompatibles en una escena');
  });

  it('updates a previously obsolete proposal and preserves rejected evidence', async () => {
    prisma.entity.findFirst.mockResolvedValue({ userLockedFields: [] });
    prisma.entityStateProposal.findFirst.mockResolvedValueOnce({
      id: 'obsolete-proposal',
      status: ProposalStatus.OBSOLETE,
    });

    await service.createProposal(proposalInput());
    expect(prisma.entityStateProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'obsolete-proposal' },
        data: expect.objectContaining({
          status: ProposalStatus.PENDING,
        }) as unknown,
      }),
    );

    prisma.entityStateProposal.findFirst.mockResolvedValueOnce({
      id: 'rejected-proposal',
      status: ProposalStatus.REJECTED,
    });
    await service.createProposal(proposalInput({ toValue: 'Palace' }));
    expect(prisma.entityStateProposal.create).not.toHaveBeenCalled();
  });

  it('obsoletes state proposals whose evidence chunk no longer matches', async () => {
    prisma.entityStateProposal.findMany.mockResolvedValue([
      {
        id: 'stale',
        sourceChunkId: 'chunk-one',
        sourceChunkHash: 'old-hash',
      },
      {
        id: 'current',
        sourceChunkId: 'chunk-two',
        sourceChunkHash: 'current-hash',
      },
    ]);

    await service.obsoleteProposalsWithoutCurrentChunkSupport({
      sceneId: 'scene-two',
      chunks: new Map([
        ['chunk-one', { contentHash: 'new-hash' }],
        ['chunk-two', { contentHash: 'current-hash' }],
      ]),
    });

    expect(prisma.entityStateProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale'] } },
      data: { status: ProposalStatus.OBSOLETE },
    });
  });

  it('lists pending proposals with their entity name and serializable confidence', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.entityStateProposal.findMany.mockResolvedValue([
      {
        ...proposalRecord(),
        createdAt,
        confidenceScore: { toString: () => '0.85' },
        entity: { canonicalName: 'Elena' },
      },
    ]);

    await expect(
      service.listPendingProposals('user-one', 'project-one'),
    ).resolves.toEqual([
      expect.objectContaining({
        entityName: 'Elena',
        evidence: ['Elena llega a la torre.'],
        confidenceScore: 0.85,
      }) as unknown,
    ]);
  });

  it('accepts a proposal with a current source chunk and schedules an audit', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    tx.entityStateProposal.findFirst.mockResolvedValue({
      ...proposalRecord(),
      sourceChunkId: 'chunk-one',
      sourceChunkHash: 'hash-one',
      entity: { projectId: 'project-one' },
    });
    tx.chunk.findFirst.mockResolvedValue({ id: 'chunk-one' });
    jest.spyOn(internals, 'getScenePositions').mockResolvedValue(positions);
    jest.spyOn(internals, 'applyStateChange').mockResolvedValue(stateRecord());
    const enqueue = jest
      .spyOn(internals, 'enqueueTemporalAudit')
      .mockResolvedValue();

    await expect(
      service.acceptProposal('user-one', 'proposal-one', {
        toValue: 'Citadel',
        validFromSceneId: 'scene-three',
      }),
    ).resolves.toMatchObject({ toValue: 'dead' });
    expect(tx.entityStateProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proposal-one' },
        data: expect.objectContaining({
          status: ProposalStatus.APPROVED,
        }) as unknown,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      tx,
      'project-one',
      'scene-three',
      positions,
    );
  });

  it('marks a proposal obsolete when its evidence is no longer current', async () => {
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);
    tx.entityStateProposal.findFirst.mockResolvedValue({
      ...proposalRecord(),
      sourceChunkId: 'chunk-one',
      sourceChunkHash: 'old-hash',
      entity: { projectId: 'project-one' },
    });
    tx.chunk.findFirst.mockResolvedValue(null);

    await expect(
      service.acceptProposal('user-one', 'proposal-one'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.entityStateProposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal-one' },
      data: { status: ProposalStatus.OBSOLETE },
    });
  });

  it('rejects missing proposals and records author rejections', async () => {
    prisma.entityStateProposal.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.rejectProposal('user-one', 'missing')).rejects.toThrow(
      NotFoundException,
    );

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

function setupTransaction(
  runner: TransactionRunner,
  tx: StateTransaction,
): void {
  runner.$transaction.mockImplementation(
    async (callback: (client: StateTransaction) => Promise<unknown>) =>
      callback(tx),
  );
}

function stateTransaction(states: unknown[]): StateTransaction {
  return {
    chunk: { findFirst: jest.fn(), findMany: jest.fn() },
    entity: { findUnique: jest.fn(), update: jest.fn() },
    entityState: {
      findMany: jest.fn().mockResolvedValue(states),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      delete: jest.fn(),
    },
    entityStateProposal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    outbox: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    scene: { findMany: jest.fn() },
  };
}

function stateProposalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-one',
    projectId: 'project-one',
    sceneId: 'scene-two',
    entityId: 'entity-one',
    attributeKey: 'location',
    fromValue: 'Port',
    toValue: 'Tower',
    sourceChunkId: 'chunk-one',
    sourceChunkHash: 'hash-one',
    conflictsWithLocked: false,
    narrativeOrder: 700,
    sequenceKind: 'TRANSITION',
    status: ProposalStatus.PENDING,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function state(
  id: string,
  attributeKey: string,
  toValue: string,
  validFromSceneId: string,
  validToSceneId: string | null,
  narrativeOrder: number | null = null,
): Pick<
  StateRecord,
  | 'id'
  | 'attributeKey'
  | 'toValue'
  | 'validFromSceneId'
  | 'validToSceneId'
  | 'narrativeOrder'
> {
  return {
    id,
    attributeKey,
    toValue,
    validFromSceneId,
    validToSceneId,
    narrativeOrder,
  };
}

function stateRecord(overrides: Partial<StateRecord> = {}): StateRecord {
  return {
    id: 'state-one',
    entityId: 'entity-one',
    attributeKey: 'status',
    fromValue: 'alive',
    toValue: 'dead',
    validFromSceneId: 'scene-two',
    validToSceneId: null,
    narrativeOrder: null,
    source: 'author_manual',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function stateChange(overrides: Partial<StateChangeInput>): StateChangeInput {
  return {
    entityId: 'entity-one',
    projectId: 'project-one',
    attributeKey: 'location',
    toValue: 'Tower',
    validFromSceneId: 'scene-two',
    validToSceneId: null,
    source: 'author_manual',
    positions: new Map([
      ['scene-one', 0],
      ['scene-two', 1],
      ['scene-three', 2],
    ]),
    ...overrides,
  };
}

function proposalInput(
  overrides: Partial<
    Parameters<TemporalStateService['createProposal']>[0]
  > = {},
): Parameters<TemporalStateService['createProposal']>[0] {
  return {
    projectId: 'project-one',
    sceneId: 'scene-two',
    sourceChunkId: 'chunk-one',
    sourceChunkHash: 'hash-one',
    entityId: 'entity-one',
    attributeKey: ' Location ',
    fromValue: 'Port',
    toValue: 'Tower',
    evidence: ['Elena llega a la torre.', 'Elena llega a la torre.'],
    confidenceScore: 0.92,
    ...overrides,
  };
}

function proposalRecord() {
  return {
    id: 'proposal-one',
    projectId: 'project-one',
    sceneId: 'scene-two',
    sourceChunkId: null,
    sourceChunkHash: null,
    entityId: 'entity-one',
    attributeKey: 'status',
    fromValue: 'alive',
    toValue: 'dead',
    evidence: ['Elena llega a la torre.'],
    confidenceScore: 0.9,
    conflictsWithLocked: false,
    status: ProposalStatus.PENDING,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
