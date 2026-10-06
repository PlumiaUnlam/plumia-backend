import { RelationType } from '@prisma/client';
import type { AuditService } from '../../../src/audit/audit.service';
import { TemporalConsistencyRuleService } from '../../../src/audit/temporal-consistency-rule.service';
import type { TemporalKnowledgeSnapshot } from '../../../src/audit/temporal-knowledge-snapshot.service';

describe('TemporalConsistencyRuleService', () => {
  const auditService = {
    createAlert: jest.fn(),
    obsoleteRuleAlertsForScene: jest.fn(),
  };
  const service = new TemporalConsistencyRuleService(
    auditService as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports two active locations for the same entity', async () => {
    await service.auditSnapshot(
      snapshotWith({
        activeStates: [
          state('elena', 'location', 'Puerto'),
          state('elena', 'location', 'Torre'),
        ],
      }),
    );

    expect(auditService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'LOCATION_CONFLICT',
        entityId: 'elena',
      }),
    );
  });

  it('reports duplicate owners only for a unique object', async () => {
    await service.auditSnapshot(
      snapshotWith({
        activeRelationships: [
          relationship('elena', 'sword'),
          relationship('marco', 'sword'),
        ],
      }),
    );

    expect(auditService.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'DUPLICATE_OWNER',
        entityId: 'sword',
      }),
    );
  });

  it('does not treat free-form state keys as mutually exclusive', async () => {
    await service.auditSnapshot(
      snapshotWith({
        activeStates: [
          state('elena', 'weapon', 'Espada'),
          state('elena', 'weapon', 'Daga'),
        ],
      }),
    );

    expect(auditService.createAlert).not.toHaveBeenCalled();
  });

  it('does not report shared ownership for an object that is not marked unique', async () => {
    await service.auditSnapshot(
      snapshotWith({
        entities: [
          entity('elena', 'Elena', 'CHARACTER'),
          entity('marco', 'Marco', 'CHARACTER'),
          entity('sword', 'Espada', 'OBJECT', {}),
        ],
        activeRelationships: [
          relationship('elena', 'sword'),
          relationship('marco', 'sword'),
        ],
      }),
    );

    expect(auditService.createAlert).not.toHaveBeenCalled();
  });
});

function snapshotWith(
  overrides: Partial<TemporalKnowledgeSnapshot>,
): TemporalKnowledgeSnapshot {
  return {
    projectId: 'project-one',
    sceneId: 'scene-one',
    worldRules: null,
    entities: [
      entity('elena', 'Elena', 'CHARACTER'),
      entity('marco', 'Marco', 'CHARACTER'),
      entity('sword', 'Espada de plata', 'OBJECT', { isUnique: true }),
    ],
    activeStates: [],
    activeFacts: [],
    activeRelationships: [],
    ...overrides,
  };
}

function entity(
  id: string,
  canonicalName: string,
  type: string,
  attributes: Record<string, unknown> = {},
): {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: string;
  attributes: Record<string, unknown>;
} {
  return { id, canonicalName, aliases: [], type, attributes };
}

function state(
  entityId: string,
  attributeKey: string,
  toValue: string,
): {
  id: string;
  entityId: string;
  attributeKey: string;
  toValue: string;
  validFromSceneId: string;
  validToSceneId: null;
} {
  return {
    id: `${entityId}-${attributeKey}-${toValue}`,
    entityId,
    attributeKey,
    toValue,
    validFromSceneId: 'scene-one',
    validToSceneId: null,
  };
}

function relationship(
  sourceEntityId: string,
  targetEntityId: string,
): {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  description: null;
  intensity: number;
  validFromSceneId: null;
  validToSceneId: null;
} {
  return {
    id: `${sourceEntityId}-${targetEntityId}`,
    sourceEntityId,
    targetEntityId,
    relationType: RelationType.OWNS,
    description: null,
    intensity: 1,
    validFromSceneId: null,
    validToSceneId: null,
  };
}
