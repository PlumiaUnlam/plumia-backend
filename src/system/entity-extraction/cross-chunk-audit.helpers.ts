import { createHash } from 'node:crypto';
import { type Prisma } from '@prisma/client';
import type {
  ContinuityCheckpointClaim,
  ExtractedContinuityCheckpoint,
  ExtractedCrossChunkInconsistency,
} from './entity-extraction.types';
import {
  type AuditChunk,
  type KnownEntity,
  MAX_CHECKPOINT_CLAIMS,
  type entitySelect,
} from './cross-chunk-audit.types';

export function combineKnownEntities(
  entities: Prisma.EntityGetPayload<{ select: typeof entitySelect }>[],
  pendingProposals: Array<{
    entityId: string | null;
    proposedData: Prisma.JsonValue;
  }>,
): KnownEntity[] {
  const knownEntities: KnownEntity[] = entities.map((entity) => ({
    ...entity,
    attributes: toAttributes(entity.attributes),
  }));
  for (const proposal of pendingProposals) {
    const candidate = toProposedEntity(
      proposal.proposedData,
      proposal.entityId,
    );
    if (!candidate) {
      continue;
    }
    const alreadyKnown = knownEntities.some(
      (entity) =>
        normalize(entity.canonicalName) === normalize(candidate.canonicalName),
    );
    if (!alreadyKnown) {
      knownEntities.push(candidate);
    }
  }
  return knownEntities;
}

export function shouldAuditSceneGroup(
  group: AuditChunk[],
  onlyDirtyChunkIds?: ReadonlySet<string>,
): boolean {
  if (group.length < 2) {
    return false;
  }
  return (
    !onlyDirtyChunkIds || group.some((chunk) => onlyDirtyChunkIds.has(chunk.id))
  );
}

export function findEntitiesInText(
  text: string,
  entities: KnownEntity[],
): KnownEntity[] {
  const normalizedText = normalize(text);
  return entities.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some((label) =>
      normalizedText.includes(normalize(label)),
    ),
  );
}

export function toVerifiedContinuityClaims(
  sceneId: string,
  extractedClaims: ExtractedContinuityCheckpoint['claims'],
  chunksByIndex: Map<number, AuditChunk>,
): ContinuityCheckpointClaim[] {
  return extractedClaims.flatMap((claim) => {
    const source = chunksByIndex.get(claim.chunkIndex);
    if (!source?.contentHash) {
      return [];
    }
    const entityName = claim.entityName.trim();
    const field = claim.field.trim();
    const value = claim.value.trim();
    const evidence = claim.evidence.trim();
    if (
      !entityName ||
      !field ||
      !value ||
      !evidence ||
      !source.content.includes(evidence)
    ) {
      return [];
    }
    return [
      {
        entityName,
        field,
        value,
        sceneId,
        chunkId: source.id,
        chunkHash: source.contentHash,
        chunkIndex: source.chunkIndex,
        evidence,
      },
    ];
  });
}

export function parseContinuityClaims(
  value: unknown,
): ContinuityCheckpointClaim[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ContinuityCheckpointClaim => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }
    const claim = item as Record<string, unknown>;
    return (
      typeof claim['entityName'] === 'string' &&
      typeof claim['field'] === 'string' &&
      typeof claim['value'] === 'string' &&
      typeof claim['sceneId'] === 'string' &&
      typeof claim['chunkId'] === 'string' &&
      typeof claim['chunkHash'] === 'string' &&
      typeof claim['chunkIndex'] === 'number' &&
      typeof claim['evidence'] === 'string'
    );
  });
}

export function mergeContinuityClaims(
  previous: ContinuityCheckpointClaim[],
  current: ContinuityCheckpointClaim[],
): ContinuityCheckpointClaim[] {
  const latest = new Map<string, ContinuityCheckpointClaim>();
  for (const claim of [...previous, ...current]) {
    latest.set(
      `${normalize(claim.entityName)}:${normalize(claim.field)}`,
      claim,
    );
  }
  return [...latest.values()].slice(-MAX_CHECKPOINT_CLAIMS);
}

export function hashSceneChunks(chunks: AuditChunk[]): string {
  return createHash('sha256')
    .update(
      [...chunks]
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .map((chunk) => `${chunk.chunkIndex}:${chunk.contentHash ?? ''}`)
        .join('|'),
    )
    .digest('hex');
}

export function findSharedEntities(
  firstText: string,
  secondText: string,
  entities: readonly KnownEntity[],
): KnownEntity[] {
  const first = normalize(firstText);
  const second = normalize(secondText);
  return entities.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some((label) => {
      const normalized = normalize(label);
      return (
        normalized.length > 1 &&
        first.includes(normalized) &&
        second.includes(normalized)
      );
    }),
  );
}

export function findKnownEntity(
  name: string,
  entities: readonly KnownEntity[],
): KnownEntity | null {
  const normalized = normalize(name);
  return (
    entities.find((entity) =>
      [entity.canonicalName, ...entity.aliases].some(
        (label) => normalize(label) === normalized,
      ),
    ) ?? null
  );
}

export function toProposedEntity(
  value: unknown,
  id: string | null,
): KnownEntity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const proposal = value as Record<string, unknown>;
  if (typeof proposal['canonicalName'] !== 'string') {
    return null;
  }
  return {
    id,
    canonicalName: proposal['canonicalName'],
    aliases: Array.isArray(proposal['aliases'])
      ? proposal['aliases'].filter(
          (alias): alias is string => typeof alias === 'string',
        )
      : [],
    type: typeof proposal['type'] === 'string' ? proposal['type'] : 'CONCEPT',
    description:
      typeof proposal['description'] === 'string'
        ? proposal['description']
        : null,
    attributes: toAttributes(proposal['attributes']),
  };
}

export function createFingerprint(input: {
  projectId: string;
  sceneId: string;
  firstChunkHash: string | null;
  secondChunkHash: string | null;
  entityId: string;
  field: string;
  firstValue: string;
  secondValue: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.projectId,
        input.sceneId,
        input.firstChunkHash ?? '',
        input.secondChunkHash ?? '',
        input.entityId,
        input.field,
        input.firstValue,
        input.secondValue,
      ]
        .map((value) => normalize(value))
        .join('|'),
    )
    .digest('hex');
}

export function cleanEvidence(value: string[] | undefined): string[] {
  return [
    ...new Set((value ?? []).map((entry) => entry?.trim()).filter(Boolean)),
  ];
}

export function findEvidencePositions(
  text: string,
  evidence: string[],
): number[] {
  return evidence.map((quote) => text.indexOf(quote));
}

export function toSeverity(
  value: ExtractedCrossChunkInconsistency['severity'],
): 'HIGH' | 'LOW' | 'MEDIUM' {
  if (value === 'HIGH') {
    return 'HIGH';
  }
  if (value === 'LOW') {
    return 'LOW';
  }
  return 'MEDIUM' as const;
}

export function normalizeConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export function toAttributes(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
