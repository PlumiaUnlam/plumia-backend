import type { TimelineImpact } from '../domain/timeline-impact';

export const TIMELINE_EVENT_REPOSITORY = Symbol('TIMELINE_EVENT_REPOSITORY');

export interface TimelineArcRecord {
  id: string;
  title: string;
}

export interface TimelineEventRecord {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  date: string | null;
  temporalLabel: string | null;
  impact: TimelineImpact;
  storyboardArcId: string | null;
  arc: TimelineArcRecord | null;
  entityIds: string[];
  position: string;
  source: string;
  sourceSceneId: string | null;
  confidenceScore: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TimelineEventListFilters {
  projectId: string;
  entityId?: string;
  storyboardArcId?: string;
  impact?: TimelineImpact;
}

export interface CreateTimelineEventData {
  projectId: string;
  title: string;
  description?: string | null;
  date?: string | null;
  temporalLabel?: string | null;
  impact?: TimelineImpact;
  storyboardArcId?: string | null;
  entityIds?: string[];
  beforeEventId?: string;
  afterEventId?: string;
  source?: string;
  sourceSceneId?: string | null;
  confidenceScore?: number;
}

export interface UpdateTimelineEventData {
  title?: string;
  description?: string | null;
  date?: string | null;
  temporalLabel?: string | null;
  impact?: TimelineImpact;
  storyboardArcId?: string | null;
  entityIds?: string[];
}

export interface TimelineEventRepository {
  listForProject(
    userId: string,
    filters: TimelineEventListFilters,
  ): Promise<TimelineEventRecord[] | null>;
  createForUser(
    userId: string,
    data: CreateTimelineEventData,
  ): Promise<TimelineEventRecord | null>;
  updateForUser(
    userId: string,
    id: string,
    data: UpdateTimelineEventData,
  ): Promise<TimelineEventRecord | null>;
  moveForUser(
    userId: string,
    id: string,
    beforeEventId?: string,
    afterEventId?: string,
  ): Promise<TimelineEventRecord | null>;
  softDeleteForUser(
    userId: string,
    id: string,
    deletedAt: Date,
  ): Promise<TimelineEventRecord | null>;
}
