// The test double models several optional Prisma delegates for pipeline paths.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable max-lines -- Public pipeline paths share one Prisma fixture. */
import { AuditSeverity } from '@prisma/client';
import type { AuditService } from '../../../src/audit/audit.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { EntityExtractionClient } from '../../../src/system/entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from '../../../src/system/entity-extraction/entity-extraction-pipeline.service';
import type { EntityResolutionService } from '../../../src/system/entity-extraction/entity-resolution.service';
import type { TemporalConsistencyRuleService } from '../../../src/audit/temporal-consistency-rule.service';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import type { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';
import { ProposalStatus } from '@prisma/client';
import type { ExtractionCandidate } from '../../../src/system/entity-extraction/entity-extraction.types';
import { EntityType } from '../../../src/knowledge/domain/entity-type';
import { RelationType } from '../../../src/knowledge/domain/relation-type';

interface PipelinePrismaMock {
  outbox: { findFirst: jest.Mock; update: jest.Mock };
  scene: { findFirst: jest.Mock; update: jest.Mock };
  entity: { findMany: jest.Mock };
  chunk: { findMany: jest.Mock; update: jest.Mock };
  entityProposal: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  relationshipProposal: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  relationship: { findFirst: jest.Mock };
  userEntityRecognitionSettings: { findUnique: jest.Mock };
  projectEntityRecognitionSettings: { findUnique: jest.Mock };
}

interface PipelineResolutionMock {
  normalize: (value: string) => string;
  dedupeCandidates: jest.Mock;
  resolveCandidate: jest.Mock;
  mergeProposalData: jest.Mock;
}

interface InconsistencyProcessor {
  processInconsistencyCandidates: (input: {
    projectId: string;
    sceneId: string;
    chunk: {
      id: string;
      chunkIndex: number;
      content: string;
      contentHash: string | null;
      isDirty: boolean;
    };
    inconsistencies: Array<{
      entityName: string;
      ruleCode:
        | 'ENTITY_CONTRADICTION'
        | 'DEAD_CHARACTER_ACTION'
        | 'WORLDBUILDING_RULE';
      field: string;
      currentValue: string;
      observedValue: string;
      explanation: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
      confidenceScore: number;
      evidence: string[];
    }>;
    confirmedEntities: Array<{
      id: string;
      canonicalName: string;
      aliases: string[];
      type: 'CHARACTER';
      description: string | null;
      attributes: Record<string, unknown>;
    }>;
  }) => Promise<void>;
}

describe('EntityExtractionPipelineService inconsistencies', () => {
  const auditService = {
    createEntityContinuityAlert: jest.fn(),
    obsoleteAlertsForChunk: jest.fn(),
  };
  const resolution = {
    normalize: (value: string) => value.trim().toLowerCase(),
  };
  const service = new EntityExtractionPipelineService(
    {} as PrismaService,
    {} as EntityExtractionClient,
    resolution as EntityResolutionService,
    auditService as unknown as AuditService,
    {} as TemporalKnowledgeSnapshotService,
    {} as TemporalConsistencyRuleService,
    {} as TemporalStateService,
  ) as unknown as InconsistencyProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a continuity alert only for a confirmed entity', async () => {
    await service.processInconsistencyCandidates({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunk: {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Elena cruza el puente.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
      inconsistencies: [
        {
          entityName: 'Eli',
          ruleCode: 'DEAD_CHARACTER_ACTION',
          field: 'estado',
          currentValue: 'Esta muerta.',
          observedValue: 'Cruza el puente.',
          explanation: 'La accion contradice el estado establecido.',
          severity: 'HIGH',
          confidenceScore: 0.94,
          evidence: ['Elena cruza el puente.'],
        },
      ],
      confirmedEntities: [
        {
          id: 'entity-1',
          canonicalName: 'Elena',
          aliases: ['Eli'],
          type: 'CHARACTER',
          description: 'Esta muerta.',
          attributes: {},
        },
      ],
    });

    expect(auditService.createEntityContinuityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        sceneId: 'scene-1',
        entityId: 'entity-1',
        entityName: 'Elena',
        severity: AuditSeverity.HIGH,
        evidence: ['Elena cruza el puente.'],
      }),
    );
    expect(auditService.obsoleteAlertsForChunk).not.toHaveBeenCalled();
  });

  it('ignores an inconsistency without an entity name', async () => {
    await service.processInconsistencyCandidates({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunk: {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Texto',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
      inconsistencies: [
        {
          entityName: '',
          ruleCode: 'ENTITY_CONTRADICTION',
          field: 'estado',
          currentValue: 'Muerta.',
          observedValue: 'Actua.',
          explanation: 'Incompatible.',
          severity: 'HIGH',
          confidenceScore: 0.9,
          evidence: ['Actua.'],
        },
      ],
      confirmedEntities: [],
    });

    expect(auditService.createEntityContinuityAlert).not.toHaveBeenCalled();
  });

  it('merges duplicate findings and their citations from one model response', async () => {
    const inconsistency = {
      entityName: 'Elena',
      ruleCode: 'DEAD_CHARACTER_ACTION' as const,
      field: 'estado',
      currentValue: 'Esta muerta.',
      observedValue: 'Cruza el puente.',
      explanation: 'La acción contradice el estado establecido.',
      severity: 'HIGH' as const,
      confidenceScore: 0.9,
      evidence: ['Elena cruza el puente.'],
    };

    await service.processInconsistencyCandidates({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunk: {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Elena cruza el puente.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
      inconsistencies: [
        inconsistency,
        { ...inconsistency, evidence: ['La guerrera llegó al puente.'] },
      ],
      confirmedEntities: [
        {
          id: 'entity-1',
          canonicalName: 'Elena',
          aliases: [],
          type: 'CHARACTER',
          description: 'Esta muerta.',
          attributes: {},
        },
      ],
    });

    expect(auditService.createEntityContinuityAlert).toHaveBeenCalledTimes(1);
    expect(auditService.createEntityContinuityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: ['Elena cruza el puente.', 'La guerrera llegó al puente.'],
      }),
    );
  });

  it('keeps an explicit inconsistency when the entity is not confirmed yet', async () => {
    await service.processInconsistencyCandidates({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunk: {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Iris llevaba los ojos verdes.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
      inconsistencies: [
        {
          entityName: 'Iris',
          ruleCode: 'ENTITY_CONTRADICTION',
          field: 'ojos',
          currentValue: 'Azules',
          observedValue: 'Verdes',
          explanation: 'El texto presenta un color incompatible.',
          severity: 'MEDIUM',
          confidenceScore: 0.86,
          evidence: ['Iris llevaba los ojos verdes.'],
        },
      ],
      confirmedEntities: [],
    });

    expect(auditService.createEntityContinuityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: null,
        entityName: 'Iris',
        field: 'ojos',
      }),
    );
  });
});

describe('EntityExtractionPipelineService outbox processing', () => {
  const scene = {
    id: 'scene-1',
    title: 'Opening',
    content: {
      type: 'doc',
      content: [{ type: 'text', text: 'Mara meets Theo.' }],
    },
    chapter: {
      id: 'chapter-1',
      title: 'Chapter',
      book: { projectId: 'project-1' },
    },
  };
  let service: EntityExtractionPipelineService;
  let prisma: PipelinePrismaMock;
  let client: {
    extractEntities: jest.Mock;
    hasEmbeddingModel: jest.Mock;
    createEmbedding: jest.Mock;
  };
  let resolution: PipelineResolutionMock;
  let audit: {
    createEntityContinuityAlert: jest.Mock;
    obsoleteAlertsForEmptyChunk: jest.Mock;
    obsoleteAlertsWithoutCurrentChunkSupport: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      outbox: { findFirst: jest.fn(), update: jest.fn() },
      scene: { findFirst: jest.fn(), update: jest.fn() },
      entity: { findMany: jest.fn().mockResolvedValue([]) },
      chunk: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      entityProposal: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      relationshipProposal: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      relationship: { findFirst: jest.fn() },
      userEntityRecognitionSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      projectEntityRecognitionSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    client = {
      extractEntities: jest.fn().mockResolvedValue({
        entities: [],
        relationships: [],
        inconsistencies: [],
      }),
      hasEmbeddingModel: jest.fn().mockReturnValue(false),
      createEmbedding: jest.fn(),
    };
    resolution = {
      normalize: (value: string) => value.trim().toLowerCase(),
      dedupeCandidates: jest.fn(
        (candidates: ExtractionCandidate[]) => candidates,
      ),
      resolveCandidate: jest.fn(),
      mergeProposalData: jest.fn(),
    };
    audit = {
      createEntityContinuityAlert: jest.fn(),
      obsoleteAlertsForEmptyChunk: jest.fn(),
      obsoleteAlertsWithoutCurrentChunkSupport: jest.fn(),
    };
    service = new EntityExtractionPipelineService(
      prisma as never,
      client as never,
      resolution as unknown as EntityResolutionService,
      audit as unknown as AuditService,
      {
        getSnapshot: jest.fn().mockResolvedValue(null),
        toExtractionContext: jest.fn(),
      } as unknown as TemporalKnowledgeSnapshotService,
      { auditSnapshot: jest.fn() } as unknown as TemporalConsistencyRuleService,
      {
        obsoleteProposalsWithoutCurrentChunkSupport: jest.fn(),
      } as unknown as TemporalStateService,
    );
  });

  it('ignores missing outbox records and marks unrelated events processed', async () => {
    prisma.outbox.findFirst.mockResolvedValue(null);
    await expect(
      service.processOutboxEvent('missing'),
    ).resolves.toBeUndefined();
    expect(prisma.outbox.update).not.toHaveBeenCalled();

    prisma.outbox.findFirst.mockResolvedValue({
      id: 'event-1',
      aggregateType: 'Book',
      eventType: 'book.changed',
      payload: {},
    });
    await service.processOutboxEvent('event-1');
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: expect.any(Date) },
    });
    expect(prisma.scene.findFirst).not.toHaveBeenCalled();
  });

  it('marks scene events processed if their scene has already been deleted', async () => {
    prisma.outbox.findFirst.mockResolvedValue({
      id: 'event-1',
      aggregateType: 'Scene',
      eventType: 'scene_changed',
      payload: {
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        contentHash: 'hash',
        wordCount: 4,
        userId: 'user-1',
      },
    });
    prisma.scene.findFirst.mockResolvedValue(null);
    await service.processOutboxEvent('event-1');
    expect(prisma.scene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'scene-1', deletedAt: null } }),
    );
    expect(prisma.outbox.update).toHaveBeenLastCalledWith({
      where: { id: 'event-1' },
      data: {
        processedAt: expect.any(Date),
        payload: expect.objectContaining({ analysisStatus: 'SUCCEEDED' }),
      },
    });
  });

  it('prunes proposals for a scene with no remaining chunks', async () => {
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.entity.findMany.mockResolvedValue([
      {
        id: 'entity-1',
        canonicalName: 'Mara',
        aliases: [],
        type: 'CHARACTER',
        description: null,
        attributes: null,
      },
    ]);
    prisma.chunk.findMany.mockResolvedValue([]);
    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 0,
      userId: 'user-1',
    });
    expect(prisma.entity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1', deletedAt: null },
      }),
    );
    expect(prisma.entityProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1', status: ProposalStatus.PENDING },
      }),
    );
    expect(client.extractEntities).not.toHaveBeenCalled();
    expect(prisma.chunk.update).not.toHaveBeenCalled();
  });

  it('clears dirty chunks without extraction when the scene content is empty', async () => {
    prisma.scene.findFirst.mockResolvedValue({
      ...scene,
      content: { type: 'doc', content: [] },
    });
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Some old text',
        contentHash: 'hash',
        isDirty: true,
      },
    ]);
    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 0,
      userId: 'user-1',
    });
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
    expect(client.extractEntities).not.toHaveBeenCalled();
  });

  it('obsoletes relationships linked to rejected entity proposals', async () => {
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([]);
    prisma.relationshipProposal.findMany.mockResolvedValue([
      {
        id: 'relationship-proposal-1',
        sourceChunkId: null,
        sourceChunkHash: null,
        sourceEntityId: null,
        targetEntityId: null,
        sourceEntityProposalId: 'entity-proposal-1',
        targetEntityProposalId: null,
      },
    ]);
    prisma.entityProposal.findMany
      .mockResolvedValueOnce([
        { id: 'entity-proposal-1', status: ProposalStatus.REJECTED },
      ])
      .mockResolvedValueOnce([]);

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 0,
      userId: 'user-1',
    });

    expect(prisma.relationshipProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['relationship-proposal-1'] } },
      data: { status: ProposalStatus.OBSOLETE },
    });
  });

  it('obsoletes a relationship when its deleted source chunk is identified by hash', async () => {
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'remaining-chunk',
        chunkIndex: 0,
        content: 'The scene still has other text.',
        contentHash: 'remaining-hash',
        isDirty: false,
      },
    ]);
    prisma.relationshipProposal.findMany
      .mockResolvedValueOnce([
        {
          id: 'relationship-proposal-1',
          sourceChunkId: null,
          sourceChunkHash: 'deleted-chunk-hash',
          sourceEntityId: 'entity-a',
          targetEntityId: 'entity-b',
          sourceEntityProposalId: null,
          targetEntityProposalId: null,
        },
      ])
      .mockResolvedValue([]);

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 5,
      userId: 'user-1',
    });

    expect(prisma.relationshipProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['relationship-proposal-1'] } },
      data: { status: ProposalStatus.OBSOLETE },
    });
    expect(client.extractEntities).not.toHaveBeenCalled();
  });

  it('keeps a relationship when its source hash still exists in an active chunk', async () => {
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'remaining-chunk',
        chunkIndex: 0,
        content: 'Equivalent source evidence remains.',
        contentHash: 'shared-hash',
        isDirty: false,
      },
    ]);
    prisma.relationshipProposal.findMany
      .mockResolvedValueOnce([
        {
          id: 'relationship-proposal-1',
          sourceChunkId: null,
          sourceChunkHash: 'shared-hash',
          sourceEntityId: 'entity-a',
          targetEntityId: 'entity-b',
          sourceEntityProposalId: null,
          targetEntityProposalId: null,
        },
      ])
      .mockResolvedValue([]);

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 5,
      userId: 'user-1',
    });

    expect(prisma.relationshipProposal.updateMany).not.toHaveBeenCalled();
    expect(client.extractEntities).not.toHaveBeenCalled();
  });

  it('ignores clean chunks and clears blank dirty chunks without sending them to extraction', async () => {
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'clean',
        chunkIndex: 0,
        content: 'Already checked',
        contentHash: 'h0',
        isDirty: false,
      },
      {
        id: 'blank',
        chunkIndex: 1,
        content: '   ',
        contentHash: 'h1',
        isDirty: true,
      },
    ]);
    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });
    expect(prisma.chunk.update).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'blank' },
      data: { isDirty: false },
    });
    expect(client.extractEntities).not.toHaveBeenCalled();
  });

  it('creates entity proposals from dirty scene text without changing manuscript content', async () => {
    const candidate: ExtractionCandidate = {
      canonicalName: 'Mara',
      aliases: ['Captain Mara'],
      type: EntityType.CHARACTER,
      description: 'A cartographer',
      attributes: { hair: 'black' },
      imageUrl: null,
      confidenceScore: 0.92,
      evidence: ['Mara opens the map.'],
    };
    const proposalData = {
      canonicalName: 'Mara',
      aliases: ['Captain Mara'],
      type: 'CHARACTER',
      description: 'A cartographer',
      attributes: { hair: 'black' },
      imageUrl: null,
      proposalKind: 'NEW_ENTITY',
      confidenceScore: 0.92,
      evidence: ['Mara opens the map.'],
      normalizedName: 'mara',
      sourceChunkId: 'chunk-1',
      sourceChunkHash: 'chunk-hash',
      chunkEvidence: [
        { chunkId: 'chunk-1', chunkHash: 'chunk-hash', chunkIndex: 0 },
      ],
      source: 'entity_extraction',
    };
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: ' Mara opens the map. ',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [candidate],
      relationships: [],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockResolvedValue({
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
      candidate,
    });
    prisma.entityProposal.create.mockResolvedValue({
      id: 'proposal-1',
      sceneId: 'scene-1',
      entityId: null,
      proposedData: proposalData,
      confidenceScore: 0.92,
      status: ProposalStatus.PENDING,
      sourceChunkId: 'chunk-1',
      sourceChunkHash: 'chunk-hash',
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(client.extractEntities).toHaveBeenCalledWith({
      userId: 'user-1',
      sceneText: 'Mara opens the map.',
      knownEntities: [],
    });
    expect(prisma.entityProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-1',
          sceneId: 'scene-1',
          sourceChunkId: 'chunk-1',
          sourceChunkHash: 'chunk-hash',
        }),
      }),
    );
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
    expect(prisma.scene.update).not.toHaveBeenCalled();
    expect(audit.obsoleteAlertsForEmptyChunk).not.toHaveBeenCalled();
    expect(audit.obsoleteAlertsWithoutCurrentChunkSupport).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', sceneId: 'scene-1' }),
    );
  });

  it('keeps failed extraction chunks dirty and leaves their outbox event retryable', async () => {
    prisma.outbox.findFirst.mockResolvedValue({
      id: 'event-1',
      aggregateType: 'Scene',
      eventType: 'scene_changed',
      payload: {
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        contentHash: 'hash',
        wordCount: 4,
        userId: 'user-1',
      },
    });
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Mara opens the map.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.processOutboxEvent('event-1')).rejects.toThrow(
      'provider unavailable',
    );

    expect(prisma.chunk.update).not.toHaveBeenCalled();
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        payload: expect.objectContaining({ analysisStatus: 'RUNNING' }),
      },
    });
  });

  it('creates only resolvable relationship proposals and clamps invalid intensity', async () => {
    const mara = {
      canonicalName: 'Mara',
      aliases: ['Captain Mara'],
      type: EntityType.CHARACTER,
      description: null,
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.9,
      evidence: ['Mara meets Theo.'],
    } satisfies ExtractionCandidate;
    const theo = {
      canonicalName: 'Theo',
      aliases: [],
      type: EntityType.CHARACTER,
      description: null,
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.8,
      evidence: ['Mara meets Theo.'],
    } satisfies ExtractionCandidate;
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Mara meets Theo.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [mara, theo],
      relationships: [
        {
          sourceEntity: 'Mara',
          targetEntity: 'Theo',
          relationType: RelationType.ALLY,
          description: 'They trust each other.',
          intensity: 1.4,
          evidence: ['Mara meets Theo.', 'Mara meets Theo.'],
        },
        {
          sourceEntity: 'Mara',
          targetEntity: 'Captain Mara',
          relationType: RelationType.ALLY,
          description: 'A self relationship should be ignored.',
          intensity: 0.7,
          evidence: [],
        },
        {
          sourceEntity: 'Unknown',
          targetEntity: 'Theo',
          relationType: RelationType.ALLY,
          description: 'An unresolved endpoint should be ignored.',
          intensity: 0.7,
          evidence: [],
        },
      ],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockImplementation(
      (candidate: ExtractionCandidate) =>
        Promise.resolve({
          confirmedEntityId: null,
          proposalId: null,
          shouldCreateProposal: true,
          candidate,
        }),
    );
    prisma.entityProposal.create
      .mockResolvedValueOnce({
        id: 'proposal-mara',
        sceneId: 'scene-1',
        entityId: null,
        proposedData: {
          canonicalName: 'Mara',
          aliases: ['Captain Mara'],
          type: EntityType.CHARACTER,
          attributes: {},
        },
        confidenceScore: 0.9,
        status: ProposalStatus.PENDING,
        sourceChunkId: 'chunk-1',
        sourceChunkHash: 'chunk-hash',
      })
      .mockResolvedValueOnce({
        id: 'proposal-theo',
        sceneId: 'scene-1',
        entityId: null,
        proposedData: {
          canonicalName: 'Theo',
          aliases: [],
          type: EntityType.CHARACTER,
          attributes: {},
        },
        confidenceScore: 0.8,
        status: ProposalStatus.PENDING,
        sourceChunkId: 'chunk-1',
        sourceChunkHash: 'chunk-hash',
      });
    prisma.relationshipProposal.create.mockResolvedValue({
      id: 'relationship-proposal-1',
      relationshipId: null,
      sourceEntityId: null,
      targetEntityId: null,
      sourceEntityProposalId: 'proposal-mara',
      targetEntityProposalId: 'proposal-theo',
      relationType: RelationType.ALLY,
      description: 'They trust each other.',
      intensity: 1,
      evidence: ['Mara meets Theo.'],
      status: ProposalStatus.PENDING,
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(prisma.relationshipProposal.create).toHaveBeenCalledTimes(1);
    expect(prisma.relationshipProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEntityProposalId: 'proposal-mara',
          targetEntityProposalId: 'proposal-theo',
          relationType: RelationType.ALLY,
          intensity: 1,
          evidence: ['Mara meets Theo.'],
        }),
      }),
    );
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
  });

  it('does not create an update proposal when extraction adds no new entity data', async () => {
    const confirmed = {
      id: 'entity-1',
      canonicalName: 'Mara',
      aliases: ['Captain Mara'],
      type: EntityType.CHARACTER,
      description: 'A cartographer',
      attributes: { hair: 'black' },
    };
    const candidate: ExtractionCandidate = {
      canonicalName: 'Mara',
      aliases: ['Captain Mara'],
      type: EntityType.CHARACTER,
      description: 'a CARTOGRAPHER',
      attributes: { hair: 'black' },
      imageUrl: null,
      confidenceScore: 0.95,
      evidence: ['Mara opens the map.'],
    };
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.entity.findMany.mockResolvedValue([confirmed]);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Mara opens the map.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [candidate],
      relationships: [],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockResolvedValue({
      confirmedEntityId: 'entity-1',
      proposalId: null,
      shouldCreateProposal: false,
      candidate,
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(prisma.entityProposal.create).not.toHaveBeenCalled();
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
  });

  it('skips a new common object below the configured relevance threshold', async () => {
    const candidate: ExtractionCandidate = {
      canonicalName: 'Una escalera',
      aliases: [],
      type: EntityType.OBJECT,
      description: 'Una escalera de madera.',
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.95,
      narrativeRelevance: 0.2,
      evidence: ['Sube por una escalera.'],
    };
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Sube por una escalera.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [candidate],
      relationships: [],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockResolvedValue({
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
      candidate,
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(prisma.entityProposal.create).not.toHaveBeenCalled();
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
  });

  it('keeps a low-relevance object when its exact name is in the project interest list', async () => {
    const candidate: ExtractionCandidate = {
      canonicalName: 'Mapa del Santuario',
      aliases: [],
      type: EntityType.OBJECT,
      description: 'Un mapa antiguo.',
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.4,
      narrativeRelevance: 0.1,
      evidence: ['Mira el Mapa del Santuario.'],
    };
    prisma.projectEntityRecognitionSettings.findUnique.mockResolvedValue({
      importantEntityNames: ['MAPA DEL SANTUARIO'],
    });
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Mira el Mapa del Santuario.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [candidate],
      relationships: [],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockResolvedValue({
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
      candidate,
    });
    prisma.entityProposal.create.mockResolvedValue({
      id: 'proposal-1',
      sceneId: 'scene-1',
      entityId: null,
      proposedData: candidate,
      confidenceScore: 0.4,
      status: ProposalStatus.PENDING,
      sourceChunkId: 'chunk-1',
      sourceChunkHash: 'chunk-hash',
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(prisma.entityProposal.create).toHaveBeenCalledTimes(1);
  });

  it('skips a new entity included in the project ignore list', async () => {
    const candidate: ExtractionCandidate = {
      canonicalName: 'Una escalera',
      aliases: [],
      type: EntityType.OBJECT,
      description: 'Una escalera de madera.',
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.99,
      narrativeRelevance: 0.99,
      evidence: ['Sube por una escalera.'],
    };
    prisma.projectEntityRecognitionSettings.findUnique.mockResolvedValue({
      importantEntityNames: [],
      ignoredEntityNames: ['UNA ESCALERA'],
    });
    prisma.scene.findFirst.mockResolvedValue(scene);
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Sube por una escalera.',
        contentHash: 'chunk-hash',
        isDirty: true,
      },
    ]);
    client.extractEntities.mockResolvedValue({
      entities: [candidate],
      relationships: [],
      inconsistencies: [],
    });
    resolution.resolveCandidate.mockResolvedValue({
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
      candidate,
    });

    await service.processSceneChanged({
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash',
      wordCount: 4,
      userId: 'user-1',
    });

    expect(prisma.entityProposal.create).not.toHaveBeenCalled();
    expect(prisma.chunk.update).toHaveBeenCalledWith({
      where: { id: 'chunk-1' },
      data: { isDirty: false },
    });
  });
});
