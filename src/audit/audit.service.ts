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
  entityId: string;
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
  entityId: string;
  entityName: string;
  field: string;
  currentValue: string;
  observedValue: string;
  explanation: string;
  evidence: string[];
  confidence: number;
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
  sourceConflict: Prisma.JsonValue;
}

type AuditResolutionStatus = Extract<AuditStatus, 'RESOLVED' | 'DISMISSED'>;

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
    status: AuditResolutionStatus,
  ): Promise<AuditAlertResponseDto> {
    const alert = await this.prisma.auditAlert.findFirst({
      where: { id: alertId, project: { userId, deletedAt: null } },
      select: { id: true },
    });

    if (!alert) {
      throw new NotFoundException('Audit alert not found');
    }

    const updated = await this.prisma.auditAlert.update({
      where: { id: alert.id },
      data: {
        status,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });

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
      if (!conflict || !['location', 'status', 'health_status'].includes(key)) {
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
        for (const state of active) {
          await tx.entityState.update({
            where: { id: state.id },
            data: { validToSceneId: alert.sceneId },
          });
        }
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
    };
    const existing = await this.prisma.auditAlert.findUnique({
      where: { fingerprint: input.fingerprint },
      select: { id: true, status: true },
    });

    if (existing) {
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
          sourceConflict,
          ...(existing.status === AuditStatus.OBSOLETE
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
        sourceConflict,
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
        sourceChunkId: true,
        sourceConflict: true,
      },
    });

    const staleIds = alerts
      .filter((alert) => {
        const conflict = this.toConflict(alert.sourceConflict);
        return (
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
        const conflict = this.toConflict(alert.sourceConflict);
        const sourceChunkId = alert.sourceChunkId ?? conflict?.sourceChunkId;
        const sourceChunkHash =
          alert.sourceChunkHash ?? conflict?.sourceChunkHash ?? null;
        if (!sourceChunkId) {
          return false;
        }
        const chunk = input.chunks.get(sourceChunkId);
        return (
          !chunk ||
          (sourceChunkHash !== null && chunk.contentHash !== sourceChunkHash)
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
      conflict: this.toConflict(alert.sourceConflict),
    };
  }

  private toConflict(value: Prisma.JsonValue):
    | (EntityConflictDetailsDto & {
        sourceChunkId?: string;
        sourceChunkHash?: string | null;
      })
    | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const conflict = value as Record<string, unknown>;
    if (
      typeof conflict['entityId'] !== 'string' ||
      typeof conflict['entityName'] !== 'string' ||
      typeof conflict['field'] !== 'string' ||
      typeof conflict['currentValue'] !== 'string' ||
      typeof conflict['observedValue'] !== 'string'
    ) {
      return null;
    }

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
    };
  }
}
