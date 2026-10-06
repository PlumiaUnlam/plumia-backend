import { createHash } from 'node:crypto';
import {
  AuditCategory,
  AuditLevel,
  AuditSeverity,
  RelationType,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';
import type { TemporalKnowledgeSnapshot } from './temporal-knowledge-snapshot.service';

const TEMPORAL_RULE_CODES = [
  'LOCATION_CONFLICT',
  'STATE_CONFLICT',
  'DUPLICATE_OWNER',
] as const;

const SINGLE_VALUE_STATE_KEYS = new Set([
  'location',
  'status',
  'health_status',
]);

@Injectable()
export class TemporalConsistencyRuleService {
  constructor(private readonly auditService: AuditService) {}

  async auditSnapshot(snapshot: TemporalKnowledgeSnapshot): Promise<void> {
    const activeFingerprints = new Set<string>();
    const entitiesById = new Map(
      snapshot.entities.map((entity) => [entity.id, entity] as const),
    );
    const statesByEntityAndKey = new Map<
      string,
      typeof snapshot.activeStates
    >();

    for (const state of snapshot.activeStates) {
      const normalizedKey = this.normalize(state.attributeKey);
      // Free-form attributes can intentionally coexist; only the standard
      // temporal attributes represent a single, objective world state.
      if (!SINGLE_VALUE_STATE_KEYS.has(normalizedKey)) {
        continue;
      }
      const key = `${state.entityId}:${normalizedKey}`;
      const states = statesByEntityAndKey.get(key) ?? [];
      states.push(state);
      statesByEntityAndKey.set(key, states);
    }

    for (const states of statesByEntityAndKey.values()) {
      const values = [
        ...new Set(
          states
            .map((state) => state.toValue?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (values.length < 2) {
        continue;
      }
      const entity = entitiesById.get(states[0]!.entityId);
      if (!entity) {
        continue;
      }
      const normalizedKey = this.normalize(states[0]!.attributeKey);
      const ruleCode =
        normalizedKey === 'location' ? 'LOCATION_CONFLICT' : 'STATE_CONFLICT';
      const fingerprint = this.fingerprint(snapshot, ruleCode, [
        entity.id,
        normalizedKey,
        ...values,
      ]);
      activeFingerprints.add(fingerprint);
      await this.auditService.createAlert({
        projectId: snapshot.projectId,
        sceneId: snapshot.sceneId,
        sourceChunkId: null,
        sourceChunkHash: null,
        fingerprint,
        ruleCode,
        detectionLevel: AuditLevel.INTER_SCENE,
        category: AuditCategory.TIMELINE,
        severity: AuditSeverity.HIGH,
        title: `Estado temporal incompatible: ${entity.canonicalName}`,
        entityId: entity.id,
        entityName: entity.canonicalName,
        field: states[0]!.attributeKey,
        currentValue: values.join(' / '),
        observedValue: 'Hay valores incompatibles vigentes en la misma escena.',
        explanation:
          'La base de conocimiento mantiene más de un valor activo para este atributo.',
        evidence: [],
        confidence: 1,
      });
    }

    const ownersByObject = new Map<string, string[]>();
    for (const relationship of snapshot.activeRelationships) {
      if (relationship.relationType !== RelationType.OWNS) {
        continue;
      }
      const owners = ownersByObject.get(relationship.targetEntityId) ?? [];
      owners.push(relationship.sourceEntityId);
      ownersByObject.set(relationship.targetEntityId, owners);
    }

    for (const [objectId, ownerIds] of ownersByObject) {
      const distinctOwnerIds = [...new Set(ownerIds)];
      const object = entitiesById.get(objectId);
      if (
        distinctOwnerIds.length < 2 ||
        !object ||
        object.type !== 'OBJECT' ||
        object.attributes['isUnique'] !== true
      ) {
        continue;
      }
      const owners = distinctOwnerIds
        .map((ownerId) => entitiesById.get(ownerId)?.canonicalName)
        .filter((owner): owner is string => Boolean(owner));
      const fingerprint = this.fingerprint(snapshot, 'DUPLICATE_OWNER', [
        object.id,
        ...distinctOwnerIds,
      ]);
      activeFingerprints.add(fingerprint);
      await this.auditService.createAlert({
        projectId: snapshot.projectId,
        sceneId: snapshot.sceneId,
        sourceChunkId: null,
        sourceChunkHash: null,
        fingerprint,
        ruleCode: 'DUPLICATE_OWNER',
        detectionLevel: AuditLevel.INTER_SCENE,
        category: AuditCategory.TIMELINE,
        severity: AuditSeverity.MEDIUM,
        title: `Posesión simultánea: ${object.canonicalName}`,
        entityId: object.id,
        entityName: object.canonicalName,
        field: 'ownership',
        currentValue: owners.join(' / '),
        observedValue: 'Más de una relación OWNS se encuentra vigente.',
        explanation:
          'El objeto está marcado como único y tiene propietarios activos simultáneos.',
        evidence: [],
        confidence: 1,
      });
    }

    await this.auditService.obsoleteRuleAlertsForScene({
      sceneId: snapshot.sceneId,
      ruleCodes: TEMPORAL_RULE_CODES,
      activeFingerprints,
    });
  }

  private fingerprint(
    snapshot: TemporalKnowledgeSnapshot,
    ruleCode: string,
    values: string[],
  ): string {
    return createHash('sha256')
      .update(
        [snapshot.projectId, snapshot.sceneId, ruleCode, ...values.sort()].join(
          '|',
        ),
      )
      .digest('hex');
  }

  private normalize(value: string): string {
    return value.trim().toLocaleLowerCase();
  }
}
