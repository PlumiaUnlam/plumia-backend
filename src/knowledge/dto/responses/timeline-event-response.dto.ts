import type { TimelineEventRecord } from '../../ports/timeline-event-repository.port';

export class TimelineEventArcResponseDto {
  id!: string;
  title!: string;
}

export class TimelineEventResponseDto {
  id!: string;
  projectId!: string;
  title!: string;
  description!: string | null;
  date!: string | null;
  temporalLabel!: string | null;
  impact!: string;
  storyboardArcId!: string | null;
  arc!: TimelineEventArcResponseDto | null;
  entityIds!: string[];
  position!: string;
  source!: string;
  sourceSceneId!: string | null;
  confidenceScore!: number;
  createdAt!: string;
  updatedAt!: string;

  static from(record: TimelineEventRecord): TimelineEventResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      title: record.title,
      description: record.description,
      date: record.date,
      temporalLabel: record.temporalLabel,
      impact: record.impact,
      storyboardArcId: record.storyboardArcId,
      arc: record.arc,
      entityIds: record.entityIds,
      position: record.position,
      source: record.source,
      sourceSceneId: record.sourceSceneId,
      confidenceScore: record.confidenceScore,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
