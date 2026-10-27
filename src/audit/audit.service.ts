/* eslint-disable max-lines */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditCategory,
  AuditLevel,
  AuditSeverity,
  AuditStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditAlertResponseDto,
  type EntityConflictDetailsDto,
} from './dto/audit-alert-response.dto';

export interface EntityContinuityAlertInput {
  projectId: string;
  sceneId: string;
  sourceChunkId: string;
  sourceChunkHash: string | null;
  fingerprint: string;
  entityId: string | null;
  entityName: string;
  field: string;
  currentValue: string;
  observedValue: string;
  explanation: string;
  evidence: string[];
  confidence: number;
  severity: AuditSeverity;
  ruleCode?: string;
  category?: AuditCategory;
  detectionLevel?: AuditLevel;
  relationship?: EntityConflictDetailsDto['relationship'];
}

export interface SupportingChunkEvidence {
  chunkId: string;
  chunkHash: string | null;
  chunkIndex: number;
  sceneId?: string;
  side: 'first' | 'second';
  evidence: string[];
  evidencePositions?: number[];
}

export interface CrossChunkContinuityAlertInput {
  projectId: string;
  sceneId: string;
  firstChunkId: string;
  firstChunkHash: string | null;
  secondChunkId: string;
  secondChunkHash: string | null;
  firstChunkIndex: number;
  secondChunkIndex: number;
  fingerprint: string;
  entityId: string | null;
  entityName: string;
  field: string;
  firstValue: string;
  secondValue: string;
  explanation: string;
  firstEvidence: string[];
  secondEvidence: string[];
  firstEvidencePositions?: number[];
  secondEvidencePositions?: number[];
  confidence: number;
  severity: AuditSeverity;
  relationship?: EntityConflictDetailsDto['relationship'];
  ruleCode?: string;
  title?: string;
  detectionLevel?: AuditLevel;
  firstSceneId?: string;
  secondSceneId?: string;
}

export interface CreateAuditAlertInput {
  projectId: string;
  sceneId: string;
  sourceChunkId: string | null;
  sourceChunkHash: string | null;
  fingerprint: string;
  ruleCode: string;
  detectionLevel: AuditLevel;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  entityId: string | null;
  entityName: string;
  field: string;
  currentValue: string;
  observedValue: string;
  explanation: string;
  evidence: string[];
  confidence: number;
  supportingChunks?: SupportingChunkEvidence[];
  relationship?: EntityConflictDetailsDto['relationship'];
}

interface AlertRow {
  id: string;
  projectId: string;
  sceneId: string;
  detectionLevel: AuditLevel;
  severity: AuditSeverity;
  category: AuditCategory;
  ruleCode: string | null;
  sourceChunkId: string | null;
  sourceChunkHash: string | null;
  title: string;
  description: string | null;
  explanation: string | null;
  confidence: Prisma.Decimal | number;
  status: AuditStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  sourceConflict: Prisma.JsonValue;
}

type AuditUpdateStatus = Extract<
  AuditStatus,
  'ACTIVE' | 'RESOLVED' | 'DISMISSED'
>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listByProject(
    userId: string,
    projectId: string,
    status: AuditStatus = AuditStatus.ACTIVE,
  ): Promise<AuditAlertResponseDto[]> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        projectId,
        status,
        project: { userId, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    return alerts.map((alert) => this.toResponse(alert));
  }

  async updateStatus(
    userId: string,
    alertId: string,
    status: AuditUpdateStatus,
  ): Promise<AuditAlertResponseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const alert = await tx.auditAlert.findFirst({
        where: { id: alertId, project: { userId, deletedAt: null } },
      });
      if (!alert) {
        return null;
      }

      if (status === AuditStatus.DISMISSED) {
        const conflict = this.toStoredConflict(alert.sourceConflict);
        const incorrectPattern = this.createSuppressionKey(
          alert.sceneId,
          alert.ruleCode ?? '',
          conflict,
        );
        const existingSuppression = await tx.auditFalsePositive.findFirst({
          where: { projectId: alert.projectId, incorrectPattern },
          select: { id: true },
        });
        if (!existingSuppression) {
          await tx.auditFalsePositive.create({
            data: {
              projectId: alert.projectId,
              alertId: alert.id,
              offendingTextQuote: conflict?.evidence[0] ?? alert.title,
              explanation: alert.explanation ?? alert.title,
              incorrectPattern,
            },
          });
        }
      }

      if (status === AuditStatus.ACTIVE) {
        const conflict = this.toStoredConflict(alert.sourceConflict);
        const incorrectPattern = this.createSuppressionKey(
          alert.sceneId,
          alert.ruleCode ?? '',
          conflict,
        );
        await tx.auditFalsePositive.deleteMany({
          where: { projectId: alert.projectId, incorrectPattern },
        });
      }

      return tx.auditAlert.update({
        where: { id: alert.id },
        data: {
          status,
          resolvedById: status === AuditStatus.ACTIVE ? null : userId,
          resolvedAt: status === AuditStatus.ACTIVE ? null : new Date(),
        },
      });
    });

    if (!updated) {
      throw new NotFoundException('Audit alert not found');
    }

    return this.toResponse(updated);
  }

  async applyKnowledgeUpdate(
    userId: string,
    alertId: string,
  ): Promise<AuditAlertResponseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const alert = await tx.auditAlert.findFirst({
        where: {
          id: alertId,
          status: AuditStatus.ACTIVE,
          project: { userId, deletedAt: null },
        },
      });
      if (!alert) {
        return null;
      }
      const conflict = this.toConflict(alert.sourceConflict);
      const key = conflict ? this.normalizeStateKey(conflict.field) : '';
      if (
        !conflict?.entityId ||
        !['location', 'status', 'health_status'].includes(key)
      ) {
        throw new BadRequestException(
          'This alert cannot be applied as a temporal knowledge update',
        );
      }
      if (alert.sourceChunkId) {
        const chunk = await tx.chunk.findFirst({
          where: {
            id: alert.sourceChunkId,
            ...(alert.sourceChunkHash === null
              ? {}
              : { contentHash: alert.sourceChunkHash }),
          },
          select: { id: true },
        });
        if (!chunk) {
          throw new BadRequestException(
            'The alert evidence is no longer current',
          );
        }
      }

      const scenes = await tx.scene.findMany({
        where: {
          deletedAt: null,
          chapter: { book: { projectId: alert.projectId, deletedAt: null } },
        },
        select: {
          id: true,
          order: true,
          sortKey: true,
          chapter: {
            select: { sortKey: true, book: { select: { sortKey: true } } },
          },
        },
      });
      const ordered = scenes.sort(
        (left, right) =>
          left.chapter.book.sortKey.localeCompare(right.chapter.book.sortKey) ||
          left.chapter.sortKey.localeCompare(right.chapter.sortKey) ||
          left.order - right.order ||
          left.sortKey.localeCompare(right.sortKey) ||
          left.id.localeCompare(right.id),
      );
      const positions = new Map(
        ordered.map((scene, index) => [scene.id, index]),
      );
      const alertPosition = positions.get(alert.sceneId);
      if (alertPosition === undefined) {
        throw new BadRequestException('The alert scene is no longer available');
      }
      const states = await tx.entityState.findMany({
        where: { entityId: conflict.entityId },
      });
      const sameScene = states.find(
        (state) =>
          this.normalizeStateKey(state.attributeKey) === key &&
          state.validFromSceneId === alert.sceneId,
      );
      const active = states.filter((state) => {
        if (this.normalizeStateKey(state.attributeKey) !== key) {
          return false;
        }
        const from = positions.get(state.validFromSceneId);
        const to = state.validToSceneId
          ? positions.get(state.validToSceneId)
          : undefined;
        return (
          from !== undefined &&
          from <= alertPosition &&
          (!state.validToSceneId || (to !== undefined && alertPosition < to))
        );
      });
      const predecessor = active.find(
        (state) => state.validFromSceneId !== alert.sceneId,
      );
      if (sameScene) {
        await tx.entityState.update({
          where: { id: sameScene.id },
          data: {
            toValue: conflict.observedValue,
            source: 'author_from_audit',
          },
        });
      } else {
        await Promise.all(
          active.map((state) =>
            tx.entityState.update({
              where: { id: state.id },
              data: { validToSceneId: alert.sceneId },
            }),
          ),
        );
        await tx.entityState.create({
          data: {
            entityId: conflict.entityId,
            attributeKey: key,
            fromValue: predecessor?.toValue ?? null,
            toValue: conflict.observedValue,
            validFromSceneId: alert.sceneId,
            source: 'author_from_audit',
            confidenceScore: 1,
          },
        });
      }
      const entity = await tx.entity.findUnique({
        where: { id: conflict.entityId },
        select: { userLockedFields: true },
      });
      if (entity && !entity.userLockedFields.includes(`state:${key}`)) {
        await tx.entity.update({
          where: { id: conflict.entityId },
          data: {
            userLockedFields: [...entity.userLockedFields, `state:${key}`],
          },
        });
      }
      await tx.outbox.createMany({
        data: ordered.slice(alertPosition).map((scene) => ({
          aggregateType: 'Scene',
          aggregateId: scene.id,
          eventType: 'scene_temporal_audit',
          payload: { sceneId: scene.id },
          createdAt: new Date(),
        })),
      });
      return tx.auditAlert.update({
        where: { id: alert.id },
        data: {
          status: AuditStatus.RESOLVED,
          resolvedById: userId,
          resolvedAt: new Date(),
        },
      });
    });
    if (!updated) {
      throw new NotFoundException('Audit alert not found');
    }
    return this.toResponse(updated);
  }

  async createEntityContinuityAlert(
    input: EntityContinuityAlertInput,
  ): Promise<void> {
    await this.createAlert({
      projectId: input.projectId,
      sceneId: input.sceneId,
      sourceChunkId: input.sourceChunkId,
      sourceChunkHash: input.sourceChunkHash,
      fingerprint: input.fingerprint,
      ruleCode: input.ruleCode ?? 'ENTITY_CONTRADICTION',
      detectionLevel: input.detectionLevel ?? AuditLevel.INTER_SCENE,
      category: input.category ?? AuditCategory.CONTINUITY,
      severity: input.severity,
      title: `Posible contradiccion: ${input.entityName}`,
      entityId: input.entityId,
      entityName: input.entityName,
      field: input.field,
      currentValue: input.currentValue,
      observedValue: input.observedValue,
      explanation: input.explanation,
      evidence: input.evidence,
      confidence: input.confidence,
      relationship: input.relationship,
    });
  }

  async createCrossChunkContinuityAlert(
    input: CrossChunkContinuityAlertInput,
  ): Promise<void> {
    await this.createAlert({
      projectId: input.projectId,
      sceneId: input.sceneId,
      sourceChunkId: input.firstChunkId,
      sourceChunkHash: input.firstChunkHash,
      fingerprint: input.fingerprint,
      ruleCode: input.ruleCode ?? 'INTRA_SCENE_CONTRADICTION',
      detectionLevel: input.detectionLevel ?? AuditLevel.INTRA_SCENE,
      category: AuditCategory.CONTINUITY,
      severity: input.severity,
      title:
        input.title ??
        'Se encontraron dos datos incompatibles dentro de esta escena',
      entityId: input.entityId,
      entityName: input.entityName,
      field: input.field,
      currentValue: input.firstValue,
      observedValue: input.secondValue,
      explanation: input.explanation,
      evidence: input.firstEvidence,
      confidence: input.confidence,
      relationship: input.relationship,
      supportingChunks: [
        {
          chunkId: input.firstChunkId,
          chunkHash: input.firstChunkHash,
          chunkIndex: input.firstChunkIndex,
          ...(input.firstSceneId ? { sceneId: input.firstSceneId } : {}),
          side: 'first',
          evidence: input.firstEvidence,
          ...(input.firstEvidencePositions
            ? { evidencePositions: input.firstEvidencePositions }
            : {}),
        },
        {
          chunkId: input.secondChunkId,
          chunkHash: input.secondChunkHash,
          chunkIndex: input.secondChunkIndex,
          ...(input.secondSceneId ? { sceneId: input.secondSceneId } : {}),
          side: 'second',
          evidence: input.secondEvidence,
          ...(input.secondEvidencePositions
            ? { evidencePositions: input.secondEvidencePositions }
            : {}),
        },
      ],
    });
  }

  async createAlert(input: CreateAuditAlertInput): Promise<void> {
    const sourceConflict = {
      entityId: input.entityId,
      entityName: input.entityName,
      field: input.field,
      currentValue: input.currentValue,
      observedValue: input.observedValue,
      evidence: input.evidence,
      sourceChunkId: input.sourceChunkId,
      sourceChunkHash: input.sourceChunkHash,
      ...(input.supportingChunks
        ? { supportingChunks: input.supportingChunks }
        : {}),
      ...(input.relationship ? { relationship: input.relationship } : {}),
    };
    const suppressionKey = this.createSuppressionKey(
      input.sceneId,
      input.ruleCode,
      {
        entityId: input.entityId,
        entityName: input.entityName,
        field: input.field,
        currentValue: input.currentValue,
        observedValue: input.observedValue,
        evidence: input.evidence,
        ...(input.relationship ? { relationship: input.relationship } : {}),
      },
    );
    const suppression = await this.prisma.auditFalsePositive.findFirst({
      where: { projectId: input.projectId, incorrectPattern: suppressionKey },
      select: { id: true },
    });
    if (suppression) {
      return;
    }

    const legacyDismissed = await this.prisma.auditAlert.findMany({
      where: {
        projectId: input.projectId,
        sceneId: input.sceneId,
        ruleCode: input.ruleCode,
        status: AuditStatus.DISMISSED,
      },
      select: { id: true, sourceConflict: true },
    });
    const legacyMatch = legacyDismissed.find((alert) =>
      this.conflictMatchesSuppressionKey(
        alert.sourceConflict,
        input.sceneId,
        input.ruleCode,
        suppressionKey,
      ),
    );
    if (legacyMatch) {
      await this.prisma.auditFalsePositive.create({
        data: {
          projectId: input.projectId,
          alertId: legacyMatch.id,
          offendingTextQuote: input.evidence[0] ?? input.title,
          explanation: input.explanation,
          incorrectPattern: suppressionKey,
        },
      });
      return;
    }

    const existing = await this.prisma.auditAlert.findUnique({
      where: { fingerprint: input.fingerprint },
      select: {
        id: true,
        status: true,
        projectId: true,
        sceneId: true,
        ruleCode: true,
        sourceConflict: true,
      },
    });

    if (existing) {
      if (existing.status === AuditStatus.DISMISSED) {
        return;
      }
      await this.prisma.auditAlert.update({
        where: { id: existing.id },
        data: {
          ruleCode: input.ruleCode,
          sourceChunkId: input.sourceChunkId,
          sourceChunkHash: input.sourceChunkHash,
          detectionLevel: input.detectionLevel,
          category: input.category,
          severity: input.severity,
          title: input.title,
          description: this.buildDescription(input),
          explanation: input.explanation,
          confidence: input.confidence,
          sourceConflict: sourceConflict as unknown as Prisma.InputJsonValue,
          ...(existing.status === AuditStatus.OBSOLETE ||
          existing.status === AuditStatus.RESOLVED
            ? {
                status: AuditStatus.ACTIVE,
                resolvedAt: null,
                resolvedById: null,
              }
            : {}),
        },
      });
      return;
    }

    const resolvedAlerts = await this.prisma.auditAlert.findMany({
      where: {
        projectId: input.projectId,
        sceneId: input.sceneId,
        ruleCode: input.ruleCode,
        status: AuditStatus.RESOLVED,
      },
      select: { id: true, sourceConflict: true },
    });
    const resolvedMatch = resolvedAlerts.find((alert) =>
      this.conflictMatchesSuppressionKey(
        alert.sourceConflict,
        input.sceneId,
        input.ruleCode,
        suppressionKey,
      ),
    );
    if (resolvedMatch) {
      await this.prisma.auditAlert.update({
        where: { id: resolvedMatch.id },
        data: {
          fingerprint: input.fingerprint,
          ruleCode: input.ruleCode,
          sourceChunkId: input.sourceChunkId,
          sourceChunkHash: input.sourceChunkHash,
          detectionLevel: input.detectionLevel,
          category: input.category,
          severity: input.severity,
          title: input.title,
          description: this.buildDescription(input),
          explanation: input.explanation,
          confidence: input.confidence,
          sourceConflict: sourceConflict as unknown as Prisma.InputJsonValue,
          status: AuditStatus.ACTIVE,
          resolvedAt: null,
          resolvedById: null,
        },
      });
      return;
    }

    await this.prisma.auditAlert.create({
      data: {
        fingerprint: input.fingerprint,
        projectId: input.projectId,
        sceneId: input.sceneId,
        sourceChunkId: input.sourceChunkId,
        sourceChunkHash: input.sourceChunkHash,
        ruleCode: input.ruleCode,
        detectionLevel: input.detectionLevel,
        severity: input.severity,
        category: input.category,
        title: input.title,
        description: this.buildDescription(input),
        explanation: input.explanation,
        confidence: input.confidence,
        sourceConflict: sourceConflict as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async obsoleteAlertsForChunk(input: {
    sceneId: string;
    sourceChunkId: string;
    activeFingerprints: ReadonlySet<string>;
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        sceneId: input.sceneId,
        status: AuditStatus.ACTIVE,
      },
      select: {
        id: true,
        fingerprint: true,
        ruleCode: true,
        sourceChunkId: true,
        sourceConflict: true,
      },
    });

    const staleIds = alerts
      .filter((alert) => {
        const conflict = this.toStoredConflict(alert.sourceConflict);
        return (
          alert.ruleCode !== 'INTRA_SCENE_CONTRADICTION' &&
          (alert.sourceChunkId ?? conflict?.sourceChunkId) ===
            input.sourceChunkId &&
          (!alert.fingerprint ||
            !input.activeFingerprints.has(alert.fingerprint))
        );
      })
      .map((alert) => alert.id);

    if (staleIds.length > 0) {
      await this.prisma.auditAlert.updateMany({
        where: { id: { in: staleIds } },
        data: { status: AuditStatus.OBSOLETE },
      });
    }
  }

  async obsoleteAlertsWithoutCurrentChunkSupport(input: {
    sceneId: string;
    chunks: ReadonlyMap<string, { contentHash: string | null }>;
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        sceneId: input.sceneId,
        status: AuditStatus.ACTIVE,
      },
      select: {
        id: true,
        sourceChunkId: true,
        sourceChunkHash: true,
        sourceConflict: true,
      },
    });
    const staleIds = alerts
      .filter((alert) => {
        const conflict = this.toStoredConflict(alert.sourceConflict);
        const sources = [
          {
            chunkId: alert.sourceChunkId ?? conflict?.sourceChunkId ?? null,
            chunkHash:
              alert.sourceChunkHash ?? conflict?.sourceChunkHash ?? null,
          },
          ...(conflict?.supportingChunks ?? []).map((source) => ({
            chunkId: source.chunkId,
            chunkHash: source.chunkHash,
          })),
        ].filter(
          (source): source is { chunkId: string; chunkHash: string | null } =>
            Boolean(source.chunkId),
        );
        return sources.some((source) => {
          const chunk = input.chunks.get(source.chunkId);
          return (
            !chunk ||
            (source.chunkHash !== null &&
              chunk.contentHash !== source.chunkHash)
          );
        });
      })
      .map((alert) => alert.id);

    if (staleIds.length > 0) {
      await this.prisma.auditAlert.updateMany({
        where: { id: { in: staleIds } },
        data: { status: AuditStatus.OBSOLETE },
      });
    }
  }

  async obsoleteRuleAlertsForScene(input: {
    sceneId: string;
    ruleCodes: readonly string[];
    activeFingerprints: ReadonlySet<string>;
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        sceneId: input.sceneId,
        status: AuditStatus.ACTIVE,
        ruleCode: { in: [...input.ruleCodes] },
      },
      select: { id: true, fingerprint: true },
    });
    const staleIds = alerts
      .filter(
        (alert) =>
          !alert.fingerprint ||
          !input.activeFingerprints.has(alert.fingerprint),
      )
      .map((alert) => alert.id);
    if (staleIds.length > 0) {
      await this.prisma.auditAlert.updateMany({
        where: { id: { in: staleIds } },
        data: { status: AuditStatus.OBSOLETE },
      });
    }
  }

  async obsoleteCrossChunkAlertsForChunks(input: {
    sceneId: string;
    sourceChunkIds: ReadonlySet<string>;
    activeFingerprints: ReadonlySet<string>;
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        sceneId: input.sceneId,
        status: AuditStatus.ACTIVE,
        ruleCode: 'INTRA_SCENE_CONTRADICTION',
      },
      select: {
        id: true,
        fingerprint: true,
        sourceChunkId: true,
        sourceConflict: true,
      },
    });
    const staleIds = alerts
      .filter((alert) => {
        const conflict = this.toStoredConflict(alert.sourceConflict);
        const supportsChangedChunk =
          (alert.sourceChunkId !== null &&
            input.sourceChunkIds.has(alert.sourceChunkId)) ||
          (conflict?.supportingChunks ?? []).some((source) =>
            input.sourceChunkIds.has(source.chunkId),
          );
        return (
          supportsChangedChunk &&
          (!alert.fingerprint ||
            !input.activeFingerprints.has(alert.fingerprint))
        );
      })
      .map((alert) => alert.id);

    if (staleIds.length > 0) {
      await this.prisma.auditAlert.updateMany({
        where: { id: { in: staleIds } },
        data: { status: AuditStatus.OBSOLETE },
      });
    }
  }

  async obsoleteCrossChunkAlertsForProject(input: {
    projectId: string;
    affectedChunkIds?: ReadonlySet<string>;
    activeFingerprints?: ReadonlySet<string>;
    ruleCodes?: string[];
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        projectId: input.projectId,
        status: AuditStatus.ACTIVE,
        ruleCode: {
          in: input.ruleCodes ?? [
            'INTRA_SCENE_CONTRADICTION',
            'CROSS_SCENE_CONTRADICTION',
          ],
        },
      },
      select: {
        id: true,
        fingerprint: true,
        sourceChunkId: true,
        sourceConflict: true,
      },
    });
    const staleIds = alerts
      .filter((alert) => {
        if (!input.affectedChunkIds) {
          return true;
        }
        const conflict = this.toStoredConflict(alert.sourceConflict);
        const isAffected =
          (alert.sourceChunkId !== null &&
            input.affectedChunkIds.has(alert.sourceChunkId)) ||
          (conflict?.supportingChunks ?? []).some((source) =>
            input.affectedChunkIds!.has(source.chunkId),
          );
        return (
          isAffected &&
          (!alert.fingerprint ||
            !input.activeFingerprints?.has(alert.fingerprint))
        );
      })
      .map((alert) => alert.id);
    if (staleIds.length > 0) {
      await this.prisma.auditAlert.updateMany({
        where: { id: { in: staleIds } },
        data: { status: AuditStatus.OBSOLETE },
      });
    }
  }

  private buildDescription(
    input: Pick<CreateAuditAlertInput, 'currentValue' | 'observedValue'>,
  ): string {
    return `La ficha indica "${input.currentValue}" y la escena aporta "${input.observedValue}".`;
  }

  private normalizeStateKey(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  private createSuppressionKey(
    sceneId: string,
    ruleCode: string,
    conflict:
      | (EntityConflictDetailsDto & {
          relationship?: EntityConflictDetailsDto['relationship'];
        })
      | null,
  ): string {
    const normalize = (value: string): string =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const subject = conflict?.relationship
      ? [
          conflict.relationship.relationshipId ??
            `${normalize(conflict.relationship.sourceEntityName)}>${normalize(conflict.relationship.targetEntityName)}`,
          normalize(conflict.relationship.relationType),
        ].join(':')
      : (conflict?.entityId ?? normalize(conflict?.entityName ?? ''));
    const values = [
      normalize(conflict?.currentValue ?? ''),
      normalize(conflict?.observedValue ?? ''),
    ].sort();

    return JSON.stringify([
      sceneId,
      ruleCode,
      subject,
      normalize(conflict?.field ?? ''),
      ...values,
    ]);
  }

  private conflictMatchesSuppressionKey(
    sourceConflict: Prisma.JsonValue,
    sceneId: string,
    ruleCode: string,
    suppressionKey: string,
  ): boolean {
    const conflict = this.toStoredConflict(sourceConflict);
    return (
      this.createSuppressionKey(sceneId, ruleCode, conflict) === suppressionKey
    );
  }

  private toResponse(alert: AlertRow): AuditAlertResponseDto {
    return {
      id: alert.id,
      projectId: alert.projectId,
      sceneId: alert.sceneId,
      detectionLevel: alert.detectionLevel,
      severity: alert.severity,
      category: alert.category,
      ruleCode: alert.ruleCode,
      sourceChunkId: alert.sourceChunkId,
      sourceChunkHash: alert.sourceChunkHash,
      title: alert.title,
      description: alert.description,
      explanation: alert.explanation,
      confidence: Number(alert.confidence),
      status: alert.status,
      createdAt: alert.createdAt,
      resolvedAt: alert.resolvedAt,
      conflict: this.toConflict(alert.sourceConflict),
    };
  }

  private toStoredConflict(value: Prisma.JsonValue):
    | (EntityConflictDetailsDto & {
        sourceChunkId?: string;
        sourceChunkHash?: string | null;
        supportingChunks?: SupportingChunkEvidence[];
        relationship?: EntityConflictDetailsDto['relationship'];
      })
    | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const conflict = value as Record<string, unknown>;
    if (
      (typeof conflict['entityId'] !== 'string' &&
        conflict['entityId'] !== null) ||
      typeof conflict['entityName'] !== 'string' ||
      typeof conflict['field'] !== 'string' ||
      typeof conflict['currentValue'] !== 'string' ||
      typeof conflict['observedValue'] !== 'string'
    ) {
      return null;
    }

    const supportingChunks = Array.isArray(conflict['supportingChunks'])
      ? conflict['supportingChunks'].flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return [];
          }
          const source = entry as Record<string, unknown>;
          if (
            typeof source['chunkId'] !== 'string' ||
            (source['chunkHash'] !== null &&
              typeof source['chunkHash'] !== 'string') ||
            (source['side'] !== 'first' && source['side'] !== 'second')
          ) {
            return [];
          }
          return [
            {
              chunkId: source['chunkId'],
              chunkHash: source['chunkHash'],
              ...(typeof source['sceneId'] === 'string'
                ? { sceneId: source['sceneId'] }
                : {}),
              chunkIndex:
                typeof source['chunkIndex'] === 'number'
                  ? source['chunkIndex']
                  : 0,
              side: source['side'],
              evidence: Array.isArray(source['evidence'])
                ? source['evidence'].filter(
                    (entry): entry is string => typeof entry === 'string',
                  )
                : [],
              ...(Array.isArray(source['evidencePositions'])
                ? {
                    evidencePositions: source['evidencePositions'].filter(
                      (entry): entry is number => typeof entry === 'number',
                    ),
                  }
                : {}),
            } satisfies SupportingChunkEvidence,
          ];
        })
      : [];
    const relationship = this.toRelationshipConflict(conflict['relationship']);

    return {
      entityId: conflict['entityId'],
      entityName: conflict['entityName'],
      field: conflict['field'],
      currentValue: conflict['currentValue'],
      observedValue: conflict['observedValue'],
      evidence: Array.isArray(conflict['evidence'])
        ? conflict['evidence'].filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
      ...(typeof conflict['sourceChunkId'] === 'string'
        ? { sourceChunkId: conflict['sourceChunkId'] }
        : {}),
      ...(typeof conflict['sourceChunkHash'] === 'string' ||
      conflict['sourceChunkHash'] === null
        ? { sourceChunkHash: conflict['sourceChunkHash'] }
        : {}),
      ...(supportingChunks.length > 0 ? { supportingChunks } : {}),
      ...(relationship ? { relationship } : {}),
    };
  }

  private toConflict(value: Prisma.JsonValue): EntityConflictDetailsDto | null {
    const conflict = this.toStoredConflict(value);
    if (!conflict) {
      return null;
    }
    return {
      entityId: conflict.entityId,
      entityName: conflict.entityName,
      field: conflict.field,
      currentValue: conflict.currentValue,
      observedValue: conflict.observedValue,
      evidence: conflict.evidence,
      ...(conflict.relationship ? { relationship: conflict.relationship } : {}),
      ...(conflict.supportingChunks
        ? {
            supportingEvidence: conflict.supportingChunks.flatMap((source) =>
              source.evidence.map((quote) => ({
                side: source.side,
                quote,
                ...(source.sceneId ? { sceneId: source.sceneId } : {}),
              })),
            ),
          }
        : {}),
    };
  }

  private toRelationshipConflict(
    value: unknown,
  ): EntityConflictDetailsDto['relationship'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const relation = value as Record<string, unknown>;
    if (
      typeof relation['sourceEntityName'] !== 'string' ||
      typeof relation['targetEntityName'] !== 'string' ||
      typeof relation['relationType'] !== 'string'
    ) {
      return null;
    }
    return {
      relationshipId:
        typeof relation['relationshipId'] === 'string'
          ? relation['relationshipId']
          : null,
      sourceEntityId:
        typeof relation['sourceEntityId'] === 'string'
          ? relation['sourceEntityId']
          : null,
      sourceEntityName: relation['sourceEntityName'],
      targetEntityId:
        typeof relation['targetEntityId'] === 'string'
          ? relation['targetEntityId']
          : null,
      targetEntityName: relation['targetEntityName'],
      relationType: relation['relationType'],
    };
  }
}
