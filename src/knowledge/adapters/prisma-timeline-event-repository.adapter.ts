import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type TimelineEvent as PrismaTimelineEvent,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { TimelineImpact } from '../domain/timeline-impact';
import type {
  CreateTimelineEventData,
  TimelineEventListFilters,
  TimelineEventRecord,
  TimelineEventRepository,
  UpdateTimelineEventData,
} from '../ports/timeline-event-repository.port';
import {
  countActiveEntitiesForProject,
  findProjectForUser,
} from './prisma-knowledge-access';

const positionStep = new Prisma.Decimal(1000);
const minimumPositionGap = new Prisma.Decimal('0.000000000001');

type TimelineEventOptionalFields = Pick<
  CreateTimelineEventData,
  'description' | 'date' | 'temporalLabel' | 'impact' | 'storyboardArcId'
>;

function toTimelineEventOptionalFields(
  data: TimelineEventOptionalFields,
): TimelineEventOptionalFields {
  return {
    ...(data.description === undefined
      ? {}
      : { description: data.description }),
    ...(data.date === undefined ? {} : { date: data.date }),
    ...(data.temporalLabel === undefined
      ? {}
      : { temporalLabel: data.temporalLabel }),
    ...(data.impact === undefined ? {} : { impact: data.impact }),
    ...(data.storyboardArcId === undefined
      ? {}
      : { storyboardArcId: data.storyboardArcId }),
  };
}

const timelineEventInclude = {
  storyboardArc: { select: { id: true, title: true } },
  entities: {
    where: { entity: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true },
  },
} as const;

type TimelineEventWithRelations = Prisma.TimelineEventGetPayload<{
  include: typeof timelineEventInclude;
}>;

@Injectable()
export class PrismaTimelineEventRepository implements TimelineEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForProject(
    userId: string,
    filters: TimelineEventListFilters,
  ): Promise<TimelineEventRecord[] | null> {
    const project = await findProjectForUser(
      this.prisma,
      userId,
      filters.projectId,
    );
    if (!project) {
      return null;
    }

    const events = await this.prisma.timelineEvent.findMany({
      where: {
        projectId: filters.projectId,
        deletedAt: null,
        ...(filters.impact === undefined ? {} : { impact: filters.impact }),
        ...(filters.storyboardArcId === undefined
          ? {}
          : { storyboardArcId: filters.storyboardArcId }),
        ...(filters.entityId === undefined
          ? {}
          : {
              entities: {
                some: {
                  entityId: filters.entityId,
                  entity: { deletedAt: null },
                },
              },
            }),
      },
      include: timelineEventInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return events.map((event) => this.toRecord(event));
  }

  async createForUser(
    userId: string,
    data: CreateTimelineEventData,
  ): Promise<TimelineEventRecord | null> {
    const eventId = await this.prisma.$transaction(async (tx) => {
      if (!(await findProjectForUser(tx, userId, data.projectId))) {
        return null;
      }
      if (
        !(await this.entityIdsBelongToProject(
          tx,
          data.projectId,
          data.entityIds,
        ))
      ) {
        return null;
      }
      if (
        data.storyboardArcId !== undefined &&
        data.storyboardArcId !== null &&
        !(await this.arcBelongsToProject(
          tx,
          data.projectId,
          data.storyboardArcId,
        ))
      ) {
        return null;
      }
      if (
        data.sourceSceneId !== undefined &&
        data.sourceSceneId !== null &&
        !(await this.sceneBelongsToProject(
          tx,
          data.projectId,
          data.sourceSceneId,
        ))
      ) {
        return null;
      }

      const position = await this.positionForPlacement(
        tx,
        data.projectId,
        data.beforeEventId,
        data.afterEventId,
      );
      if (!position) {
        return null;
      }

      const event = await tx.timelineEvent.create({
        data: {
          projectId: data.projectId,
          title: data.title,
          ...toTimelineEventOptionalFields(data),
          position,
          ...(data.source === undefined ? {} : { source: data.source }),
          ...(data.sourceSceneId === undefined
            ? {}
            : { sourceSceneId: data.sourceSceneId }),
          ...(data.confidenceScore === undefined
            ? {}
            : { confidenceScore: new Prisma.Decimal(data.confidenceScore) }),
          entities: {
            create: [...new Set(data.entityIds ?? [])].map((entityId) => ({
              entityId,
            })),
          },
        },
      });

      return event.id;
    });

    return eventId ? this.findByIdForUser(userId, eventId) : null;
  }

  async updateForUser(
    userId: string,
    id: string,
    data: UpdateTimelineEventData,
  ): Promise<TimelineEventRecord | null> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timelineEvent.findFirst({
        where: {
          id,
          deletedAt: null,
          project: { userId, deletedAt: null },
        },
        select: { id: true, projectId: true },
      });
      if (!existing) {
        return false;
      }

      if (
        !(await this.entityIdsBelongToProject(
          tx,
          existing.projectId,
          data.entityIds,
        ))
      ) {
        return false;
      }
      if (
        data.storyboardArcId !== undefined &&
        data.storyboardArcId !== null &&
        !(await this.arcBelongsToProject(
          tx,
          existing.projectId,
          data.storyboardArcId,
        ))
      ) {
        return false;
      }

      await tx.timelineEvent.update({
        where: { id },
        data: {
          ...(data.title === undefined ? {} : { title: data.title }),
          ...toTimelineEventOptionalFields(data),
          ...(data.entityIds === undefined
            ? {}
            : {
                entities: {
                  deleteMany: {},
                  create: [...new Set(data.entityIds)].map((entityId) => ({
                    entityId,
                  })),
                },
              }),
        },
      });
      return true;
    });

    return updated ? this.findByIdForUser(userId, id) : null;
  }

  async moveForUser(
    userId: string,
    id: string,
    beforeEventId?: string,
    afterEventId?: string,
  ): Promise<TimelineEventRecord | null> {
    const moved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timelineEvent.findFirst({
        where: {
          id,
          deletedAt: null,
          project: { userId, deletedAt: null },
        },
        select: { id: true, projectId: true },
      });
      if (!existing) {
        return false;
      }

      const position = await this.positionForPlacement(
        tx,
        existing.projectId,
        beforeEventId,
        afterEventId,
        id,
      );
      if (!position) {
        return false;
      }

      await tx.timelineEvent.update({ where: { id }, data: { position } });
      return true;
    });

    return moved ? this.findByIdForUser(userId, id) : null;
  }

  async softDeleteForUser(
    userId: string,
    id: string,
    deletedAt: Date,
  ): Promise<TimelineEventRecord | null> {
    const result = await this.prisma.timelineEvent.updateMany({
      where: {
        id,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      data: { deletedAt },
    });

    return result.count > 0 ? this.findByIdForUser(userId, id) : null;
  }

  private async findByIdForUser(
    userId: string,
    id: string,
  ): Promise<TimelineEventRecord | null> {
    const event = await this.prisma.timelineEvent.findFirst({
      where: { id, project: { userId, deletedAt: null } },
      include: timelineEventInclude,
    });
    return event ? this.toRecord(event) : null;
  }

  private async entityIdsBelongToProject(
    client: Prisma.TransactionClient,
    projectId: string,
    entityIds: string[] | undefined,
  ): Promise<boolean> {
    if (entityIds === undefined || entityIds.length === 0) {
      return true;
    }
    const uniqueEntityIds = [...new Set(entityIds)];
    const count = await countActiveEntitiesForProject(
      client,
      projectId,
      uniqueEntityIds,
    );
    return count === uniqueEntityIds.length;
  }

  private async arcBelongsToProject(
    client: Prisma.TransactionClient,
    projectId: string,
    storyboardArcId: string,
  ): Promise<boolean> {
    const arc = await client.storyboardArc.findFirst({
      where: { id: storyboardArcId, projectId, deletedAt: null },
      select: { id: true },
    });
    return arc !== null;
  }

  private async sceneBelongsToProject(
    client: Prisma.TransactionClient,
    projectId: string,
    sceneId: string,
  ): Promise<boolean> {
    const scene = await client.scene.findFirst({
      where: { id: sceneId, deletedAt: null, chapter: { book: { projectId } } },
      select: { id: true },
    });
    return scene !== null;
  }

  private async positionForPlacement(
    client: Prisma.TransactionClient,
    projectId: string,
    beforeEventId?: string,
    afterEventId?: string,
    excludedEventId?: string,
    hasReindexed = false,
  ): Promise<Prisma.Decimal | null> {
    const scope = this.placementScope(projectId, excludedEventId);
    const anchors = await this.findPlacementAnchors(
      client,
      scope,
      beforeEventId,
      afterEventId,
    );
    if (!anchors) {
      return null;
    }

    const bounds = await this.findPlacementBounds(client, scope, anchors);
    const lower = anchors.after?.position ?? bounds.previous?.position;
    const upper = anchors.before?.position ?? bounds.next?.position;
    if (lower && upper) {
      const gap = upper.minus(lower);
      if (gap.lessThanOrEqualTo(minimumPositionGap) && !hasReindexed) {
        await this.reindexPositions(client, projectId, excludedEventId);
        return this.positionForPlacement(
          client,
          projectId,
          beforeEventId,
          afterEventId,
          excludedEventId,
          true,
        );
      }
      return lower.plus(upper).dividedBy(2);
    }
    if (lower) {
      return lower.plus(positionStep);
    }
    if (upper) {
      return upper.minus(positionStep);
    }
    return bounds.last ? bounds.last.position.plus(positionStep) : positionStep;
  }

  private placementScope(
    projectId: string,
    excludedEventId?: string,
  ): Prisma.TimelineEventWhereInput {
    return {
      projectId,
      deletedAt: null,
      ...(excludedEventId === undefined
        ? {}
        : { id: { not: excludedEventId } }),
    };
  }

  private async findPlacementAnchors(
    client: Prisma.TransactionClient,
    scope: Prisma.TimelineEventWhereInput,
    beforeEventId?: string,
    afterEventId?: string,
  ): Promise<{
    before: { position: Prisma.Decimal } | null;
    after: { position: Prisma.Decimal } | null;
  } | null> {
    const [before, after] = await Promise.all([
      beforeEventId === undefined
        ? Promise.resolve(null)
        : client.timelineEvent.findFirst({
            where: { ...scope, id: beforeEventId },
            select: { position: true },
          }),
      afterEventId === undefined
        ? Promise.resolve(null)
        : client.timelineEvent.findFirst({
            where: { ...scope, id: afterEventId },
            select: { position: true },
          }),
    ]);

    const missingBefore = beforeEventId !== undefined && !before;
    const missingAfter = afterEventId !== undefined && !after;
    const invalidOrder =
      before && after && !after.position.lessThan(before.position);
    return missingBefore || missingAfter || invalidOrder
      ? null
      : { before, after };
  }

  private async findPlacementBounds(
    client: Prisma.TransactionClient,
    scope: Prisma.TimelineEventWhereInput,
    anchors: {
      before: { position: Prisma.Decimal } | null;
      after: { position: Prisma.Decimal } | null;
    },
  ): Promise<{
    previous: { position: Prisma.Decimal } | null;
    next: { position: Prisma.Decimal } | null;
    last: { position: Prisma.Decimal } | null;
  }> {
    const [previous, next, last] = await Promise.all([
      anchors.before
        ? client.timelineEvent.findFirst({
            where: { ...scope, position: { lt: anchors.before.position } },
            orderBy: { position: 'desc' },
            select: { position: true },
          })
        : Promise.resolve(null),
      anchors.after
        ? client.timelineEvent.findFirst({
            where: { ...scope, position: { gt: anchors.after.position } },
            orderBy: { position: 'asc' },
            select: { position: true },
          })
        : Promise.resolve(null),
      !anchors.before && !anchors.after
        ? client.timelineEvent.findFirst({
            where: scope,
            orderBy: { position: 'desc' },
            select: { position: true },
          })
        : Promise.resolve(null),
    ]);
    return { previous, next, last };
  }

  private async reindexPositions(
    client: Prisma.TransactionClient,
    projectId: string,
    excludedEventId?: string,
  ): Promise<void> {
    const events = await client.timelineEvent.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(excludedEventId === undefined
          ? {}
          : { id: { not: excludedEventId } }),
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    await Promise.all(
      events.map((event, index) =>
        client.timelineEvent.update({
          where: { id: event.id },
          data: { position: positionStep.times(index + 1) },
        }),
      ),
    );
  }

  private toRecord(
    event: TimelineEventWithRelations | PrismaTimelineEvent,
  ): TimelineEventRecord {
    const relatedEvent = event as TimelineEventWithRelations;
    return {
      id: event.id,
      projectId: event.projectId,
      title: event.title,
      description: event.description,
      date: event.date,
      temporalLabel: event.temporalLabel,
      impact: event.impact as TimelineImpact,
      storyboardArcId: event.storyboardArcId,
      arc: relatedEvent.storyboardArc ?? null,
      entityIds: relatedEvent.entities?.map((entity) => entity.entityId) ?? [],
      position: event.position.toString(),
      source: event.source,
      sourceSceneId: event.sourceSceneId,
      confidenceScore: Number(event.confidenceScore),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      deletedAt: event.deletedAt,
    };
  }
}
