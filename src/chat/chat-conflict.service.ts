import { Injectable } from '@nestjs/common';
import { AuditStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatOpenConflict, ChatSource } from './domain/chat.types';

const MAX_CANDIDATE_ALERTS = 200;
const MAX_RELEVANT_ALERTS = 5;
const GENERIC_TERMS = new Set([
  'capitulo',
  'como',
  'donde',
  'escena',
  'estaba',
  'esta',
  'estuvo',
  'historia',
  'manuscrito',
  'novela',
  'obra',
  'personaje',
  'personajes',
  'sabemos',
  'sobre',
  'wiki',
]);

@Injectable()
export class ChatConflictService {
  constructor(private readonly prisma: PrismaService) {}

  async findRelevant(
    projectId: string,
    question: string,
    sources: readonly ChatSource[],
    signal?: AbortSignal,
  ): Promise<ChatOpenConflict[]> {
    const sceneIds = [
      ...new Set(
        sources.flatMap((source) => (source.sceneId ? [source.sceneId] : [])),
      ),
    ];
    const entityIds = [
      ...new Set(
        sources.flatMap((source) => (source.entityId ? [source.entityId] : [])),
      ),
    ];
    if (sceneIds.length === 0 && entityIds.length === 0) {
      return [];
    }

    const candidateFilters: Prisma.AuditAlertWhereInput[] = [
      ...(sceneIds.length > 0 ? [{ sceneId: { in: sceneIds } }] : []),
      ...entityIds.map((entityId) => ({
        sourceConflict: { path: ['entityId'], equals: entityId },
      })),
    ];
    const alertsQuery = {
      where: {
        projectId,
        status: AuditStatus.ACTIVE,
        OR: candidateFilters,
      },
      select: {
        id: true,
        title: true,
        description: true,
        explanation: true,
        sceneId: true,
        sourceChunkId: true,
        sourceChunkHash: true,
        sourceConflict: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_CANDIDATE_ALERTS,
    } satisfies Prisma.AuditAlertFindManyArgs;
    const alerts = await this.prisma.auditAlert.findMany(alertsQuery);
    throwIfAborted(signal);
    if (alerts.length === 0) {
      return [];
    }
    let pageLength = alerts.length;
    let lastAlertId = alerts.at(-1)?.id;
    while (pageLength === MAX_CANDIDATE_ALERTS && lastAlertId) {
      const nextPage = await this.prisma.auditAlert.findMany({
        ...alertsQuery,
        cursor: { id: lastAlertId },
        skip: 1,
      });
      throwIfAborted(signal);
      alerts.push(...nextPage);
      pageLength = nextPage.length;
      lastAlertId = nextPage.at(-1)?.id;
    }

    const linkedChunkIds = [
      ...new Set(
        alerts.flatMap((alert) =>
          alert.sourceChunkId ? [alert.sourceChunkId] : [],
        ),
      ),
    ];
    const currentChunks =
      linkedChunkIds.length > 0
        ? await this.prisma.chunk.findMany({
            where: { projectId, id: { in: linkedChunkIds } },
            select: { id: true, contentHash: true },
          })
        : [];
    throwIfAborted(signal);
    const currentHashById = new Map(
      currentChunks.map((chunk) => [chunk.id, chunk.contentHash]),
    );
    const retrievedChunkIds = new Set(
      sources
        .filter((source) => source.kind === 'manuscript')
        .map((source) => source.id.replace(/^manuscript:/, '')),
    );
    const retrievedSceneIds = new Set(sceneIds);
    const retrievedEntityIds = new Set(entityIds);
    const queryTerms = significantTerms(question);

    return alerts
      .filter((alert) => {
        if (alert.sourceChunkId) {
          if (!currentHashById.has(alert.sourceChunkId)) {
            return false;
          }
          if (
            alert.sourceChunkHash &&
            currentHashById.get(alert.sourceChunkId) !== alert.sourceChunkHash
          ) {
            return false;
          }
        }
        const conflict = readConflict(alert.sourceConflict);
        const alertText = normalize(
          [
            alert.title,
            alert.description,
            alert.explanation,
            conflict?.entityName,
            conflict?.field,
          ]
            .filter(Boolean)
            .join(' '),
        );
        if (alert.sourceChunkId && retrievedChunkIds.has(alert.sourceChunkId)) {
          return queryTerms.some((term) => alertText.includes(term));
        }
        if (conflict?.entityId && retrievedEntityIds.has(conflict.entityId)) {
          const entityWords = new Set(
            significantTerms(conflict.entityName ?? ''),
          );
          const topicTerms = queryTerms.filter(
            (term) => !entityWords.has(term),
          );
          if (topicTerms.length === 0) {
            return true;
          }
          const topicText = normalize(
            [alert.title, alert.description, alert.explanation, conflict.field]
              .filter(Boolean)
              .join(' '),
          );
          return topicTerms.some((term) => topicText.includes(term));
        }
        if (!retrievedSceneIds.has(alert.sceneId)) {
          return false;
        }
        return queryTerms.some((term) => alertText.includes(term));
      })
      .slice(0, MAX_RELEVANT_ALERTS)
      .map((alert) => {
        const conflict = readConflict(alert.sourceConflict);
        return {
          id: alert.id,
          title: alert.title,
          description: alert.description,
          explanation: alert.explanation,
          sceneId: alert.sceneId,
          ...(conflict?.entityName ? { entityName: conflict.entityName } : {}),
          ...(conflict?.field ? { field: conflict.field } : {}),
          ...(conflict?.currentValue
            ? { currentValue: conflict.currentValue }
            : {}),
          ...(conflict?.observedValue
            ? { observedValue: conflict.observedValue }
            : {}),
        };
      });
  }
}

function readConflict(value: Prisma.JsonValue): {
  entityId?: string;
  entityName?: string;
  field?: string;
  currentValue?: string;
  observedValue?: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return {
    ...(typeof value['entityId'] === 'string'
      ? { entityId: value['entityId'] }
      : {}),
    ...(typeof value['entityName'] === 'string'
      ? { entityName: value['entityName'] }
      : {}),
    ...(typeof value['field'] === 'string' ? { field: value['field'] } : {}),
    ...(typeof value['currentValue'] === 'string'
      ? { currentValue: value['currentValue'] }
      : {}),
    ...(typeof value['observedValue'] === 'string'
      ? { observedValue: value['observedValue'] }
      : {}),
  };
}

function significantTerms(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !GENERIC_TERMS.has(term));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Chat request aborted by the client');
    error.name = 'AbortError';
    throw error;
  }
}
