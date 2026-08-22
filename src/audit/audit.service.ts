import { Injectable, NotFoundException } from '@nestjs/common';
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
}

interface AlertRow {
  id: string;
  projectId: string;
  sceneId: string;
  detectionLevel: AuditLevel;
  severity: AuditSeverity;
  category: AuditCategory;
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

  async createEntityContinuityAlert(
    input: EntityContinuityAlertInput,
  ): Promise<void> {
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
          severity: input.severity,
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
        detectionLevel: AuditLevel.INTER_SCENE,
        severity: input.severity,
        category: AuditCategory.CONTINUITY,
        title: `Posible contradiccion: ${input.entityName}`,
        description: this.buildDescription(input),
        explanation: input.explanation,
        confidence: input.confidence,
        sourceConflict,
      },
    });
  }

  async obsoleteContinuityAlertsForChunk(input: {
    sceneId: string;
    sourceChunkId: string;
    activeFingerprints: ReadonlySet<string>;
  }): Promise<void> {
    const alerts = await this.prisma.auditAlert.findMany({
      where: {
        sceneId: input.sceneId,
        status: AuditStatus.ACTIVE,
        category: AuditCategory.CONTINUITY,
      },
      select: { id: true, fingerprint: true, sourceConflict: true },
    });

    const staleIds = alerts
      .filter((alert) => {
        const conflict = this.toConflict(alert.sourceConflict);
        return (
          conflict?.sourceChunkId === input.sourceChunkId &&
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

  private buildDescription(input: EntityContinuityAlertInput): string {
    return `La ficha indica "${input.currentValue}" y la escena aporta "${input.observedValue}".`;
  }

  private toResponse(alert: AlertRow): AuditAlertResponseDto {
    return {
      id: alert.id,
      projectId: alert.projectId,
      sceneId: alert.sceneId,
      detectionLevel: alert.detectionLevel,
      severity: alert.severity,
      category: alert.category,
      title: alert.title,
      description: alert.description,
      explanation: alert.explanation,
      confidence: Number(alert.confidence),
      status: alert.status,
      createdAt: alert.createdAt,
      conflict: this.toConflict(alert.sourceConflict),
    };
  }

  private toConflict(
    value: Prisma.JsonValue,
  ): (EntityConflictDetailsDto & { sourceChunkId?: string }) | null {
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
    };
  }
}
