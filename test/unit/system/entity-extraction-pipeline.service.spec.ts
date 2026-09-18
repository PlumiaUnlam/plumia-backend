import { AuditSeverity } from '@prisma/client';
import type { AuditService } from '../../../src/audit/audit.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { EntityExtractionClient } from '../../../src/system/entity-extraction/entity-extraction.client';
import { EntityExtractionPipelineService } from '../../../src/system/entity-extraction/entity-extraction-pipeline.service';
import type { EntityResolutionService } from '../../../src/system/entity-extraction/entity-resolution.service';
import type { TemporalConsistencyRuleService } from '../../../src/audit/temporal-consistency-rule.service';
import type { TemporalKnowledgeSnapshotService } from '../../../src/audit/temporal-knowledge-snapshot.service';
import type { TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';

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
    expect(auditService.obsoleteAlertsForChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: 'scene-1',
        sourceChunkId: 'chunk-1',
        activeFingerprints: expect.any(Set) as unknown,
      }),
    );
  });

  it('ignores an inconsistency whose entity cannot be resolved', async () => {
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
          entityName: 'Desconocida',
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
});
