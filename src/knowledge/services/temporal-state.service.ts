/* eslint-disable max-lines */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EpistemicType,
  type EntityState,
  Prisma,
  ProposalStatus,
} from '@prisma/client';
import {
  TemporalKnowledgeSnapshotService,
  type TemporalEntity,
  type TemporalRelationship,
} from '../../audit/temporal-knowledge-snapshot.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEntityStateDto } from '../dto/create-entity-state.dto';
import type { EntityStateProposalOverrideDto } from '../dto/entity-state-proposal-override.dto';
import { EntityStateProposalResponseDto } from '../dto/responses/entity-state-proposal-response.dto';
import { EntityStateResponseDto } from '../dto/responses/entity-state-response.dto';
import type { UpdateEntityStateDto } from '../dto/update-entity-state.dto';

const SINGLE_VALUE_STATE_KEYS = new Set([
  'location',
  'status',
  'health_status',
]);

type DatabaseClient = PrismaService | Prisma.TransactionClient;

interface OrderedScene {
  id: string;
  title: string | null;
  bookSortKey: string;
  chapterSortKey: string;
  order: number;
  sortKey: string;
}

export interface TemporalKnowledgeView {
  sceneId: string;
  scenes: Array<{ id: string; title: string | null }>;
  entities: Array<
    TemporalEntity & {
      dynamicStates: Array<{ key: string; value: string | null }>;
    }
  >;
  relationships: TemporalRelationship[];
}

export interface CreateStateProposalInput {
  projectId: string;
  sceneId: string;
  sourceChunkId: string;
  sourceChunkHash: string | null;
  entityId: string;
  attributeKey: string;
  fromValue: string | null;
  toValue: string;
  evidence: string[];
  confidenceScore: number;
}

/** Owns author-approved state transitions and their reviewable AI proposals. */
@Injectable()
export class TemporalStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: TemporalKnowledgeSnapshotService,
  ) {}

  async listStates(
    userId: string,
    entityId: string,
  ): Promise<EntityStateResponseDto[]> {
    await this.getEntityForUser(userId, entityId);
    const states = await this.prisma.entityState.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
    });
    return states.map((state) => this.toStateResponse(state));
  }

  async createState(
    userId: string,
    entityId: string,
    dto: CreateEntityStateDto,
  ): Promise<EntityStateResponseDto> {
    const entity = await this.getEntityForUser(userId, entityId);
    const state = await this.prisma.$transaction(async (tx) => {
      const positions = await this.getScenePositions(tx, entity.projectId);
      this.assertWindow(positions, dto.validFromSceneId, dto.validToSceneId);
      const created = await this.applyStateChange(tx, {
        entityId,
        projectId: entity.projectId,
        attributeKey: dto.attributeKey,
        toValue: dto.toValue,
        validFromSceneId: dto.validFromSceneId,
        validToSceneId: dto.validToSceneId ?? null,
        source: 'author_manual',
        positions,
      });
      await this.lockStateKey(tx, entityId, dto.attributeKey);
      await this.enqueueTemporalAudit(
        tx,
        entity.projectId,
        dto.validFromSceneId,
        positions,
      );
      return created;
    });
    return this.toStateResponse(state);
  }

  async updateState(
    userId: string,
    stateId: string,
    dto: UpdateEntityStateDto,
  ): Promise<EntityStateResponseDto> {
    const state = await this.prisma.entityState.findFirst({
      where: {
        id: stateId,
        entity: { project: { userId, deletedAt: null }, deletedAt: null },
      },
      include: { entity: { select: { projectId: true } } },
    });
    if (!state) {
      throw new NotFoundException('Entity state not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const positions = await this.getScenePositions(
        tx,
        state.entity.projectId,
      );
      this.assertWindow(
        positions,
        state.validFromSceneId,
        dto.validToSceneId === undefined
          ? state.validToSceneId
          : dto.validToSceneId,
      );
      const result = await tx.entityState.update({
        where: { id: state.id },
        data: {
          ...(dto.toValue === undefined ? {} : { toValue: dto.toValue.trim() }),
          ...(dto.validToSceneId === undefined
            ? {}
            : { validToSceneId: dto.validToSceneId }),
        },
      });
      await this.assertNoStandardOverlaps(tx, state.entityId, positions);
      await this.lockStateKey(tx, state.entityId, state.attributeKey);
      await this.enqueueTemporalAudit(
        tx,
        state.entity.projectId,
        state.validFromSceneId,
        positions,
      );
      return result;
    });
    return this.toStateResponse(updated);
  }

  async removeState(userId: string, stateId: string): Promise<void> {
    const state = await this.prisma.entityState.findFirst({
      where: {
        id: stateId,
        entity: { project: { userId, deletedAt: null }, deletedAt: null },
      },
      include: { entity: { select: { projectId: true } } },
    });
    if (!state) {
      throw new NotFoundException('Entity state not found');
    }
    await this.prisma.$transaction(async (tx) => {
      const positions = await this.getScenePositions(
        tx,
        state.entity.projectId,
      );
      await tx.entityState.delete({ where: { id: state.id } });
      await this.enqueueTemporalAudit(
        tx,
        state.entity.projectId,
        state.validFromSceneId,
        positions,
      );
    });
  }

  async listPendingProposals(
    userId: string,
    projectId: string,
  ): Promise<EntityStateProposalResponseDto[]> {
    const proposals = await this.prisma.entityStateProposal.findMany({
      where: {
        projectId,
        status: ProposalStatus.PENDING,
        project: { userId, deletedAt: null },
      },
      include: { entity: { select: { canonicalName: true } } },
      orderBy: [{ confidenceScore: 'desc' }, { createdAt: 'desc' }],
    });
    return proposals.map((proposal) => this.toProposalResponse(proposal));
  }

  async acceptProposal(
    userId: string,
    proposalId: string,
    override?: EntityStateProposalOverrideDto,
  ): Promise<EntityStateResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.entityStateProposal.findFirst({
        where: {
          id: proposalId,
          status: ProposalStatus.PENDING,
          project: { userId, deletedAt: null },
        },
        include: { entity: { select: { projectId: true } } },
      });
      if (!proposal) {
        return null;
      }
      if (proposal.sourceChunkId) {
        const chunk = await tx.chunk.findFirst({
          where: {
            id: proposal.sourceChunkId,
            ...(proposal.sourceChunkHash === null
              ? {}
              : { contentHash: proposal.sourceChunkHash }),
          },
          select: { id: true },
        });
        if (!chunk) {
          await tx.entityStateProposal.update({
            where: { id: proposal.id },
            data: { status: ProposalStatus.OBSOLETE },
          });
          throw new BadRequestException(
            'La evidencia de la propuesta ya no esta vigente',
          );
        }
      }

      const validFromSceneId = override?.validFromSceneId ?? proposal.sceneId;
      const validToSceneId = override?.validToSceneId ?? null;
      const positions = await this.getScenePositions(tx, proposal.projectId);
      this.assertWindow(positions, validFromSceneId, validToSceneId);
      const state = await this.applyStateChange(tx, {
        entityId: proposal.entityId,
        projectId: proposal.projectId,
        attributeKey: override?.attributeKey ?? proposal.attributeKey,
        toValue: override?.toValue ?? proposal.toValue ?? '',
        validFromSceneId,
        validToSceneId,
        source: 'ai_proposed',
        positions,
      });
      await tx.entityStateProposal.update({
        where: { id: proposal.id },
        data: {
          status: ProposalStatus.APPROVED,
          reviewedById: userId,
          reviewedAt: new Date(),
          resolutionReason: 'accepted_by_author',
        },
      });
      await this.enqueueTemporalAudit(
        tx,
        proposal.projectId,
        validFromSceneId,
        positions,
      );
      return state;
    });
    if (!result) {
      throw new NotFoundException('Entity state proposal not found');
    }
    return this.toStateResponse(result);
  }

  async rejectProposal(userId: string, proposalId: string): Promise<void> {
    const result = await this.prisma.entityStateProposal.updateMany({
      where: {
        id: proposalId,
        status: ProposalStatus.PENDING,
        project: { userId, deletedAt: null },
      },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedById: userId,
        reviewedAt: new Date(),
        resolutionReason: 'rejected_by_author',
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Entity state proposal not found');
    }
  }

  async createProposal(input: CreateStateProposalInput): Promise<void> {
    const attributeKey = this.normalizeKey(input.attributeKey);
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: input.entityId,
        projectId: input.projectId,
        deletedAt: null,
      },
      select: { userLockedFields: true },
    });
    if (!entity || !attributeKey || !input.toValue.trim()) {
      return;
    }
    const evidence = this.normalizeEvidence(input.evidence);
    const matching = {
      projectId: input.projectId,
      sceneId: input.sceneId,
      sourceChunkId: input.sourceChunkId,
      sourceChunkHash: input.sourceChunkHash,
      entityId: input.entityId,
      attributeKey,
      toValue: input.toValue.trim(),
    };
    const existing = await this.prisma.entityStateProposal.findFirst({
      where: matching,
      select: { id: true, status: true },
    });
    if (existing?.status === ProposalStatus.REJECTED) {
      return;
    }
    const conflictsWithLocked = entity.userLockedFields.includes(
      `state:${attributeKey}`,
    );
    if (existing) {
      await this.prisma.entityStateProposal.update({
        where: { id: existing.id },
        data: {
          fromValue: input.fromValue,
          evidence,
          confidenceScore: input.confidenceScore,
          conflictsWithLocked,
          ...(existing.status === ProposalStatus.OBSOLETE
            ? { status: ProposalStatus.PENDING }
            : {}),
        },
      });
      return;
    }
    await this.prisma.entityStateProposal.create({
      data: {
        ...matching,
        fromValue: input.fromValue,
        evidence,
        confidenceScore: input.confidenceScore,
        conflictsWithLocked,
      },
    });
  }

  async obsoleteProposalsWithoutCurrentChunkSupport(input: {
    sceneId: string;
    chunks: ReadonlyMap<string, { contentHash: string | null }>;
  }): Promise<void> {
    const proposals = await this.prisma.entityStateProposal.findMany({
      where: { sceneId: input.sceneId, status: ProposalStatus.PENDING },
      select: { id: true, sourceChunkId: true, sourceChunkHash: true },
    });
    const staleIds = proposals
      .filter((proposal) => {
        if (!proposal.sourceChunkId) {
          return false;
        }
        const chunk = input.chunks.get(proposal.sourceChunkId);
        return (
          !chunk ||
          (proposal.sourceChunkHash !== null &&
            chunk.contentHash !== proposal.sourceChunkHash)
        );
      })
      .map((proposal) => proposal.id);
    if (staleIds.length > 0) {
      await this.prisma.entityStateProposal.updateMany({
        where: { id: { in: staleIds } },
        data: { status: ProposalStatus.OBSOLETE },
      });
    }
  }

  async getTemporalView(
    userId: string,
    projectId: string,
    sceneId: string,
  ): Promise<TemporalKnowledgeView> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    const snapshot = await this.snapshots.getSnapshot(sceneId);
    if (snapshot?.projectId !== projectId) {
      throw new NotFoundException('Scene not found');
    }
    const scenes = await this.getOrderedScenes(this.prisma, projectId);
    const statesByEntity = new Map<
      string,
      Array<{ key: string; value: string | null }>
    >();
    for (const state of snapshot.activeStates) {
      const values = statesByEntity.get(state.entityId) ?? [];
      values.push({ key: state.attributeKey, value: state.toValue });
      statesByEntity.set(state.entityId, values);
    }
    return {
      sceneId,
      scenes: scenes.map((scene) => ({ id: scene.id, title: scene.title })),
      entities: snapshot.entities.map((entity) => ({
        ...entity,
        dynamicStates: statesByEntity.get(entity.id) ?? [],
      })),
      relationships: snapshot.activeRelationships,
    };
  }

  async validateRelationshipWindow(
    projectId: string,
    validFromSceneId: string | null | undefined,
    validToSceneId: string | null | undefined,
  ): Promise<void> {
    const positions = await this.getScenePositions(this.prisma, projectId);
    const from = validFromSceneId ? positions.get(validFromSceneId) : undefined;
    const to = validToSceneId ? positions.get(validToSceneId) : undefined;
    if (
      (validFromSceneId && from === undefined) ||
      (validToSceneId && to === undefined)
    ) {
      throw new BadRequestException(
        'Relationship scenes must belong to the same project',
      );
    }
    if (from !== undefined && to !== undefined && from >= to) {
      throw new BadRequestException(
        'The relationship end scene must be after its start scene',
      );
    }
  }

  async scheduleRelationshipAudit(
    projectId: string,
    changedAtSceneId: string | null | undefined,
  ): Promise<void> {
    if (!changedAtSceneId) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const positions = await this.getScenePositions(tx, projectId);
      await this.enqueueTemporalAudit(
        tx,
        projectId,
        changedAtSceneId,
        positions,
      );
    });
  }

  private async applyStateChange(
    tx: Prisma.TransactionClient,
    input: {
      entityId: string;
      projectId: string;
      attributeKey: string;
      toValue: string;
      validFromSceneId: string;
      validToSceneId: string | null;
      source: string;
      positions: ReadonlyMap<string, number>;
    },
  ): Promise<EntityState> {
    const attributeKey = this.normalizeKey(input.attributeKey);
    const toValue = input.toValue.trim();
    if (!attributeKey || !toValue) {
      throw new BadRequestException('A state key and value are required');
    }
    const states = await tx.entityState.findMany({
      where: { entityId: input.entityId },
      select: {
        id: true,
        attributeKey: true,
        toValue: true,
        validFromSceneId: true,
        validToSceneId: true,
      },
    });
    const matching = states.filter(
      (state) => this.normalizeKey(state.attributeKey) === attributeKey,
    );
    const fromPosition = input.positions.get(input.validFromSceneId);
    if (fromPosition === undefined) {
      throw new BadRequestException('The state start scene is invalid');
    }
    const active = matching.filter((state) =>
      this.isActiveAt(state, input.positions, fromPosition),
    );
    const sameScene = active.find(
      (state) => state.validFromSceneId === input.validFromSceneId,
    );
    if (this.isSingleValueKey(attributeKey) && sameScene) {
      return tx.entityState.update({
        where: { id: sameScene.id },
        data: {
          toValue,
          validToSceneId: input.validToSceneId,
          source: input.source,
        },
      });
    }
    if (this.isSingleValueKey(attributeKey)) {
      await Promise.all(
        active.map((state) =>
          tx.entityState.update({
            where: { id: state.id },
            data: { validToSceneId: input.validFromSceneId },
          }),
        ),
      );
    }
    const predecessor = matching
      .filter((state) => {
        const position = input.positions.get(state.validFromSceneId);
        return position !== undefined && position < fromPosition;
      })
      .sort(
        (left, right) =>
          (input.positions.get(right.validFromSceneId) ?? -1) -
          (input.positions.get(left.validFromSceneId) ?? -1),
      )[0];
    return tx.entityState.create({
      data: {
        entityId: input.entityId,
        attributeKey,
        fromValue: predecessor?.toValue ?? null,
        toValue,
        validFromSceneId: input.validFromSceneId,
        validToSceneId: input.validToSceneId,
        epistemicType: EpistemicType.OBJECTIVE,
        confidenceScore: 1,
        source: input.source,
      },
    });
  }

  private async getEntityForUser(
    userId: string,
    entityId: string,
  ): Promise<{ id: string; projectId: string }> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true, projectId: true },
    });
    if (!entity) {
      throw new NotFoundException('Entity not found');
    }
    return entity;
  }

  private async getScenePositions(
    client: DatabaseClient,
    projectId: string,
  ): Promise<Map<string, number>> {
    const scenes = await this.getOrderedScenes(client, projectId);
    return new Map(scenes.map((scene, index) => [scene.id, index]));
  }

  private async getOrderedScenes(
    client: DatabaseClient,
    projectId: string,
  ): Promise<OrderedScene[]> {
    const scenes = await client.scene.findMany({
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
          select: { sortKey: true, book: { select: { sortKey: true } } },
        },
      },
    });
    return scenes
      .map((scene) => ({
        id: scene.id,
        title: scene.title,
        order: scene.order,
        sortKey: scene.sortKey,
        chapterSortKey: scene.chapter.sortKey,
        bookSortKey: scene.chapter.book.sortKey,
      }))
      .sort(
        (left, right) =>
          left.bookSortKey.localeCompare(right.bookSortKey) ||
          left.chapterSortKey.localeCompare(right.chapterSortKey) ||
          left.order - right.order ||
          left.sortKey.localeCompare(right.sortKey) ||
          left.id.localeCompare(right.id),
      );
  }

  private assertWindow(
    positions: ReadonlyMap<string, number>,
    validFromSceneId: string,
    validToSceneId: string | null | undefined,
  ): void {
    const fromPosition = positions.get(validFromSceneId);
    const toPosition = validToSceneId
      ? positions.get(validToSceneId)
      : undefined;
    if (
      fromPosition === undefined ||
      (validToSceneId && toPosition === undefined)
    ) {
      throw new BadRequestException(
        'State scenes must belong to the same project',
      );
    }
    if (toPosition !== undefined && fromPosition >= toPosition) {
      throw new BadRequestException(
        'The state end scene must be after its start scene',
      );
    }
  }

  private async assertNoStandardOverlaps(
    tx: Prisma.TransactionClient,
    entityId: string,
    positions: ReadonlyMap<string, number>,
  ): Promise<void> {
    const states = await tx.entityState.findMany({ where: { entityId } });
    for (const key of SINGLE_VALUE_STATE_KEYS) {
      const matching = states.filter(
        (state) => this.normalizeKey(state.attributeKey) === key,
      );
      for (let index = 0; index < matching.length; index += 1) {
        const current = matching[index]!;
        const currentInterval = this.getStateInterval(current, positions);
        if (!currentInterval) {
          continue;
        }
        for (const other of matching.slice(index + 1)) {
          const otherInterval = this.getStateInterval(other, positions);
          if (!otherInterval) {
            continue;
          }
          if (this.intervalsOverlap(currentInterval, otherInterval)) {
            throw new BadRequestException(
              `Overlapping ${key} states are not allowed`,
            );
          }
        }
      }
    }
  }

  private getStateInterval(
    state: Pick<EntityState, 'validFromSceneId' | 'validToSceneId'>,
    positions: ReadonlyMap<string, number>,
  ): { start: number; end: number } | null {
    const start = positions.get(state.validFromSceneId);
    const end = state.validToSceneId
      ? positions.get(state.validToSceneId)
      : Infinity;
    return start === undefined || end === undefined ? null : { start, end };
  }

  private intervalsOverlap(
    left: { start: number; end: number },
    right: { start: number; end: number },
  ): boolean {
    return left.start < right.end && right.start < left.end;
  }

  private async lockStateKey(
    tx: Prisma.TransactionClient,
    entityId: string,
    attributeKey: string,
  ): Promise<void> {
    const entity = await tx.entity.findUnique({
      where: { id: entityId },
      select: { userLockedFields: true },
    });
    if (!entity) {
      return;
    }
    const lock = `state:${this.normalizeKey(attributeKey)}`;
    if (entity.userLockedFields.includes(lock)) {
      return;
    }
    await tx.entity.update({
      where: { id: entityId },
      data: { userLockedFields: [...entity.userLockedFields, lock] },
    });
  }

  private async enqueueTemporalAudit(
    tx: Prisma.TransactionClient,
    projectId: string,
    fromSceneId: string,
    positions: ReadonlyMap<string, number>,
  ): Promise<void> {
    const fromPosition = positions.get(fromSceneId);
    if (fromPosition === undefined) {
      return;
    }
    const scenes = await this.getOrderedScenes(tx, projectId);
    await tx.outbox.createMany({
      data: scenes.slice(fromPosition).map((scene) => ({
        aggregateType: 'Scene',
        aggregateId: scene.id,
        eventType: 'scene_temporal_audit',
        payload: { sceneId: scene.id },
        createdAt: new Date(),
      })),
    });
  }

  private isActiveAt(
    state: { validFromSceneId: string; validToSceneId: string | null },
    positions: ReadonlyMap<string, number>,
    position: number,
  ): boolean {
    const from = positions.get(state.validFromSceneId);
    const to = state.validToSceneId
      ? positions.get(state.validToSceneId)
      : undefined;
    return (
      from !== undefined &&
      from <= position &&
      (!state.validToSceneId || (to !== undefined && position < to))
    );
  }

  private toStateResponse(state: {
    id: string;
    entityId: string;
    attributeKey: string;
    fromValue: string | null;
    toValue: string | null;
    validFromSceneId: string;
    validToSceneId: string | null;
    source: string;
    createdAt: Date;
  }): EntityStateResponseDto {
    return { ...state };
  }

  private toProposalResponse(proposal: {
    id: string;
    projectId: string;
    sceneId: string;
    sourceChunkId: string | null;
    sourceChunkHash: string | null;
    entityId: string;
    attributeKey: string;
    fromValue: string | null;
    toValue: string | null;
    evidence: Prisma.JsonValue;
    confidenceScore: Prisma.Decimal;
    conflictsWithLocked: boolean;
    status: ProposalStatus;
    createdAt: Date;
    entity: { canonicalName: string };
  }): EntityStateProposalResponseDto {
    return {
      id: proposal.id,
      projectId: proposal.projectId,
      sceneId: proposal.sceneId,
      sourceChunkId: proposal.sourceChunkId,
      sourceChunkHash: proposal.sourceChunkHash,
      entityId: proposal.entityId,
      entityName: proposal.entity.canonicalName,
      attributeKey: proposal.attributeKey,
      fromValue: proposal.fromValue,
      toValue: proposal.toValue,
      evidence: this.normalizeEvidence(proposal.evidence),
      confidenceScore: Number(proposal.confidenceScore),
      conflictsWithLocked: proposal.conflictsWithLocked,
      status: proposal.status,
      createdAt: proposal.createdAt,
    };
  }

  private normalizeEvidence(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
  }

  private normalizeKey(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  private isSingleValueKey(key: string): boolean {
    return SINGLE_VALUE_STATE_KEYS.has(key);
  }
}
