import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProposalStatus } from '@prisma/client';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  type TemporalStateInternals,
  setupTransaction,
  stateTransaction,
  stateProposalRecord,
  stateRecord,
  proposalInput,
  proposalRecord,
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

  it('accumulates evidence when the same state proposal is detected again', async () => {
    prisma.entity.findFirst.mockResolvedValue({ userLockedFields: [] });
    prisma.entityStateProposal.findFirst.mockResolvedValue({
      id: 'existing-proposal',
      status: ProposalStatus.PENDING,
      evidence: ['Cita anterior.'],
      confidenceScore: 0.95,
    });

    await service.createProposal(
      proposalInput({
        evidence: ['Cita nueva.'],
        confidenceScore: 0.8,
      }),
    );

    expect(prisma.entityStateProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-proposal' },
        data: expect.objectContaining({
          evidence: ['Cita anterior.', 'Cita nueva.'],
          confidenceScore: 0.95,
        }) as unknown,
      }),
    );
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
        sourceChunkId: 'chunk-one',
        sourceChunkHash: 'hash-one',
        sourceChunk: { contentHash: 'hash-one', isDirty: false },
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

  it('hides state proposals and blocks manual state writes when tracking is disabled', async () => {
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateTrackingEnabled: false,
    });
    prisma.entity.findFirst.mockResolvedValue({
      id: 'entity-one',
      projectId: 'project-one',
    });
    const tx = stateTransaction([]);
    setupTransaction(prisma, tx);

    await expect(
      service.listPendingProposals('user-one', 'project-one'),
    ).resolves.toEqual([]);
    expect(prisma.entityStateProposal.findMany).not.toHaveBeenCalled();
    await expect(
      service.createState('user-one', 'entity-one', {
        attributeKey: 'location',
        toValue: 'Tower',
        validFromSceneId: 'scene-one',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
});
