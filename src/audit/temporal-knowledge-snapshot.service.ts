import { EpistemicType, Prisma, RelationType } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TemporalAuditContext } from '../system/entity-extraction/entity-extraction.types';
import {
  normalizeEntityStateKey,
  SINGLE_VALUE_STATE_KEYS,
} from '../knowledge/domain/entity-state-keys';

export interface TemporalEntity {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: string;
  attributes: Record<string, unknown>;
}

export interface TemporalEntityState {
  id: string;
  entityId: string;
  attributeKey: string;
  toValue: string | null;
  validFromSceneId: string;
  validToSceneId: string | null;
  narrativeOrder: number | null;
  createdAt: Date;
}

export interface TemporalRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  description: string | null;
  intensity: number;
  validFromSceneId: string | null;
  validToSceneId: string | null;
}

export interface HistoricalTemporalRelationship extends TemporalRelationship {
  validFromScene: string | null;
  validToScene: string;
}

export interface TemporalKnowledgeSnapshot {
  projectId: string;
  sceneId: string;
  worldRules: Prisma.JsonValue | null;
  entities: TemporalEntity[];
  activeStates: TemporalEntityState[];
  activeStateRows?: TemporalEntityState[];
  activeFacts: Array<{ entityId: string; content: string }>;
  activeRelationships: TemporalRelationship[];
  historicalRelationships?: HistoricalTemporalRelationship[];
}

interface OrderedScene {
  id: string;
  bookSortKey: string;
  chapterSortKey: string;
  order: number;
  sortKey: string;
}

/** Rebuilds the author-visible world state without leaking future scenes. */
@Injectable()
export class TemporalKnowledgeSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(
    sceneId: string,
  ): Promise<TemporalKnowledgeSnapshot | null> {
    const targetScene = await this.prisma.scene.findFirst({
      where: { id: sceneId, deletedAt: null },
      select: {
        id: true,
        chapter: {
          select: {
            book: {
              select: {
                projectId: true,
                project: {
                  select: {
                    genreRules: true,
                    knowledgeReviewSettings: {
                      select: { stateTrackingEnabled: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!targetScene) {
      return null;
    }

    const projectId = targetScene.chapter.book.projectId;
    const scenes = await this.prisma.scene.findMany({
      where: {
        deletedAt: null,
        chapter: { book: { projectId, deletedAt: null } },
      },
      select: {
        id: true,
        title: true,
        order: true,
        sortKey: true,
        chapter: {
          select: {
            title: true,
            sortKey: true,
            book: { select: { title: true, sortKey: true } },
          },
        },
      },
    });
    const positions = this.toScenePositions(
      scenes.map((scene) => ({
        id: scene.id,
        order: scene.order,
        sortKey: scene.sortKey,
        chapterSortKey: scene.chapter.sortKey,
        bookSortKey: scene.chapter.book.sortKey,
      })),
    );
    const currentPosition = positions.get(sceneId);
    if (currentPosition === undefined) {
      return null;
    }

    const stateTrackingEnabled =
      targetScene.chapter.book.project.knowledgeReviewSettings
        ?.stateTrackingEnabled ?? false;
    const [entities, states, facts, relationships] = await Promise.all([
      this.prisma.entity.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          canonicalName: true,
          aliases: true,
          type: true,
          attributes: true,
        },
      }),
      stateTrackingEnabled
        ? this.prisma.entityState.findMany({
            where: {
              entity: { projectId, deletedAt: null },
              epistemicType: EpistemicType.OBJECTIVE,
            },
            select: {
              id: true,
              entityId: true,
              attributeKey: true,
              toValue: true,
              validFromSceneId: true,
              validToSceneId: true,
              narrativeOrder: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.fact.findMany({
        where: {
          entity: { projectId, deletedAt: null },
          isRetconned: false,
          epistemicType: EpistemicType.OBJECTIVE,
        },
        select: { entityId: true, content: true, sourceSceneId: true },
      }),
      this.prisma.relationship.findMany({
        where: {
          projectId,
          epistemicType: EpistemicType.OBJECTIVE,
          sourceEntity: { deletedAt: null },
          targetEntity: { deletedAt: null },
        },
        select: {
          id: true,
          sourceEntityId: true,
          targetEntityId: true,
          relationType: true,
          description: true,
          confidenceScore: true,
          validFromSceneId: true,
          validToSceneId: true,
        },
      }),
    ]);

    const activeStateRows = states.filter((state) =>
      this.isActiveAt(
        state.validFromSceneId,
        state.validToSceneId,
        positions,
        currentPosition,
      ),
    );
    const activeStates = this.selectActiveStates(activeStateRows, positions);
    const sceneLabels = new Map(
      scenes.map((scene) => {
        const sceneTitle = scene.title?.trim();
        return [
          scene.id,
          [
            scene.chapter.book.title,
            scene.chapter.title,
            sceneTitle?.length ? sceneTitle : `Escena ${scene.order + 1}`,
          ].join(' / '),
        ];
      }),
    );
    const mapRelationship = (
      relationship: (typeof relationships)[number],
    ): TemporalRelationship => ({
      id: relationship.id,
      sourceEntityId: relationship.sourceEntityId,
      targetEntityId: relationship.targetEntityId,
      relationType: relationship.relationType,
      description: relationship.description,
      intensity: Number(relationship.confidenceScore),
      validFromSceneId: relationship.validFromSceneId,
      validToSceneId: relationship.validToSceneId,
    });

    return {
      projectId,
      sceneId,
      worldRules: targetScene.chapter.book.project.genreRules,
      entities: entities.map((entity) => ({
        ...entity,
        attributes: this.toAttributes(entity.attributes),
      })),
      activeStates,
      activeStateRows,
      activeFacts: facts
        .filter(
          (fact) =>
            (positions.get(fact.sourceSceneId) ?? Infinity) <= currentPosition,
        )
        .map(({ entityId, content }) => ({ entityId, content })),
      activeRelationships: relationships
        .filter((relationship) =>
          this.isActiveAt(
            relationship.validFromSceneId,
            relationship.validToSceneId,
            positions,
            currentPosition,
          ),
        )
        .map(mapRelationship),
      historicalRelationships: relationships
        .filter((relationship) =>
          this.hasEndedAtOrBefore(
            relationship.validFromSceneId,
            relationship.validToSceneId,
            positions,
            currentPosition,
          ),
        )
        .flatMap((relationship) => {
          const validToSceneId = relationship.validToSceneId;
          if (!validToSceneId) {
            return [];
          }
          return [
            {
              ...mapRelationship(relationship),
              validFromScene: relationship.validFromSceneId
                ? (sceneLabels.get(relationship.validFromSceneId) ?? null)
                : null,
              validToScene:
                sceneLabels.get(validToSceneId) ?? `Escena ${validToSceneId}`,
            },
          ];
        }),
    };
  }

  toExtractionContext(
    snapshot: TemporalKnowledgeSnapshot,
    chunkText: string,
  ): TemporalAuditContext {
    const normalizedText = this.normalize(chunkText);
    const relevantEntities = snapshot.entities.filter((entity) =>
      [entity.canonicalName, ...entity.aliases].some((label) =>
        this.containsLabel(normalizedText, label),
      ),
    );
    const relevantIds = new Set(relevantEntities.map((entity) => entity.id));
    const entitiesById = new Map(
      snapshot.entities.map((entity) => [entity.id, entity] as const),
    );
    const statesByEntity = new Map<
      string,
      Array<{ key: string; value: string }>
    >();
    for (const state of snapshot.activeStates) {
      const value = state.toValue?.trim();
      if (!value) {
        continue;
      }
      const current = statesByEntity.get(state.entityId) ?? [];
      current.push({ key: state.attributeKey, value });
      statesByEntity.set(state.entityId, current);
    }
    const factsByEntity = new Map<string, string[]>();
    for (const fact of snapshot.activeFacts) {
      const current = factsByEntity.get(fact.entityId) ?? [];
      current.push(fact.content);
      factsByEntity.set(fact.entityId, current);
    }

    const relationships = snapshot.activeRelationships
      .filter(
        (relationship) =>
          relevantIds.has(relationship.sourceEntityId) ||
          relevantIds.has(relationship.targetEntityId),
      )
      .flatMap((relationship) => {
        const source = entitiesById.get(relationship.sourceEntityId);
        const target = entitiesById.get(relationship.targetEntityId);
        if (!source || !target) {
          return [];
        }
        return [
          {
            sourceEntity: source.canonicalName,
            targetEntity: target.canonicalName,
            relationType: relationship.relationType,
            description: relationship.description,
          },
        ];
      });

    const relationshipHistory = (snapshot.historicalRelationships ?? [])
      .filter(
        (relationship) =>
          relevantIds.has(relationship.sourceEntityId) ||
          relevantIds.has(relationship.targetEntityId),
      )
      .flatMap((relationship) => {
        const source = entitiesById.get(relationship.sourceEntityId);
        const target = entitiesById.get(relationship.targetEntityId);
        if (!source || !target) {
          return [];
        }
        return [
          {
            sourceEntity: source.canonicalName,
            targetEntity: target.canonicalName,
            relationType: relationship.relationType,
            description: relationship.description,
            validFromScene: relationship.validFromScene,
            validToScene: relationship.validToScene,
          },
        ];
      });

    return {
      worldRules: snapshot.worldRules,
      entities: relevantEntities.map((entity) => ({
        canonicalName: entity.canonicalName,
        states: statesByEntity.get(entity.id) ?? [],
        facts: factsByEntity.get(entity.id) ?? [],
      })),
      relationships,
      relationshipHistory,
      deceasedEntityNames: relevantEntities
        .filter((entity) =>
          (statesByEntity.get(entity.id) ?? []).some(
            (state) =>
              this.normalize(state.key) === 'status' &&
              this.normalize(state.value) === 'dead',
          ),
        )
        .map((entity) => entity.canonicalName),
    };
  }

  private toScenePositions(scenes: OrderedScene[]): Map<string, number> {
    const ordered = [...scenes].sort(
      (left, right) =>
        left.bookSortKey.localeCompare(right.bookSortKey) ||
        left.chapterSortKey.localeCompare(right.chapterSortKey) ||
        left.order - right.order ||
        left.sortKey.localeCompare(right.sortKey) ||
        left.id.localeCompare(right.id),
    );
    return new Map(ordered.map((scene, index) => [scene.id, index]));
  }

  private selectActiveStates(
    states: TemporalEntityState[],
    positions: ReadonlyMap<string, number>,
  ): TemporalEntityState[] {
    const customStates: TemporalEntityState[] = [];
    const latestSingleValueStates = new Map<string, TemporalEntityState>();

    for (const state of states) {
      const key = normalizeEntityStateKey(state.attributeKey);
      if (!SINGLE_VALUE_STATE_KEYS.has(key)) {
        customStates.push(state);
        continue;
      }

      const stateKey = `${state.entityId}:${key}`;
      const current = latestSingleValueStates.get(stateKey);
      const statePosition = positions.get(state.validFromSceneId) ?? -1;
      const currentPosition = current
        ? (positions.get(current.validFromSceneId) ?? -1)
        : -1;
      const stateOrder = state.narrativeOrder ?? -1;
      const currentOrder = current?.narrativeOrder ?? -1;
      if (
        !current ||
        statePosition > currentPosition ||
        (statePosition === currentPosition &&
          (stateOrder > currentOrder ||
            (stateOrder === currentOrder &&
              state.createdAt > current.createdAt)))
      ) {
        latestSingleValueStates.set(stateKey, state);
      }
    }

    return [...customStates, ...latestSingleValueStates.values()];
  }

  private isActiveAt(
    validFromSceneId: string | null,
    validToSceneId: string | null,
    positions: ReadonlyMap<string, number>,
    currentPosition: number,
  ): boolean {
    const validFrom = validFromSceneId
      ? positions.get(validFromSceneId)
      : undefined;
    const validTo = validToSceneId ? positions.get(validToSceneId) : undefined;
    return (
      (!validFromSceneId ||
        (validFrom !== undefined && validFrom <= currentPosition)) &&
      (!validToSceneId || (validTo !== undefined && currentPosition < validTo))
    );
  }

  private hasEndedAtOrBefore(
    validFromSceneId: string | null,
    validToSceneId: string | null,
    positions: ReadonlyMap<string, number>,
    currentPosition: number,
  ): boolean {
    if (!validToSceneId) {
      return false;
    }
    const validFrom = validFromSceneId
      ? positions.get(validFromSceneId)
      : undefined;
    const validTo = positions.get(validToSceneId);
    return (
      (!validFromSceneId ||
        (validFrom !== undefined && validFrom <= currentPosition)) &&
      validTo !== undefined &&
      validTo <= currentPosition
    );
  }

  private toAttributes(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  private containsLabel(text: string, label: string): boolean {
    const normalizedLabel = this.normalize(label);
    return normalizedLabel.length > 1 && text.includes(normalizedLabel);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
