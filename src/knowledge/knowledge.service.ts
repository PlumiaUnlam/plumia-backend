import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import {
  ENTITY_REPOSITORY,
  type EntityListFilters,
  type EntityRecord,
  type EntityRepository,
} from './ports/entity-repository.port';
import {
  RELATIONSHIP_REPOSITORY,
  type RelationshipRecord,
  type RelationshipRepository,
} from './ports/relationship-repository.port';
import type {
  EntitySearch,
  EntitySearchResult,
} from './ports/entity-search.port';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { CreateTimelineEventDto } from './dto/timeline/create-timeline-event.dto';
import { MoveTimelineEventDto } from './dto/timeline/move-timeline-event.dto';
import { UpdateTimelineEventDto } from './dto/timeline/update-timeline-event.dto';
import {
  TIMELINE_EVENT_REPOSITORY,
  type TimelineEventListFilters,
  type TimelineEventRecord,
  type TimelineEventRepository,
} from './ports/timeline-event-repository.port';

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(ENTITY_SEARCH) private readonly entitySearch: EntitySearch,
    @Inject(ENTITY_REPOSITORY)
    private readonly entityRepository: EntityRepository,
    @Inject(RELATIONSHIP_REPOSITORY)
    private readonly relationshipRepository: RelationshipRepository,
    @Inject(TIMELINE_EVENT_REPOSITORY)
    private readonly timelineEventRepository: TimelineEventRepository,
  ) {}

  searchEntities(
    projectId: string,
    query: string,
    limit = 10,
  ): Promise<EntitySearchResult[]> {
    return this.entitySearch.searchByName({ projectId, query, limit });
  }

  listEntities(filters: EntityListFilters): Promise<EntityRecord[]> {
    return this.entityRepository.list(filters);
  }

  listRelationships(
    userId: string,
    projectId: string,
  ): Promise<RelationshipRecord[]> {
    return this.relationshipRepository.listByProject(userId, projectId);
  }

  async createEntity(
    _userId: string,
    projectId: string,
    dto: CreateEntityDto,
  ): Promise<EntityRecord> {
    return this.entityRepository.create({
      projectId,
      canonicalName: dto.canonicalName,
      type: dto.type,
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.aliases === undefined ? {} : { aliases: dto.aliases }),
      ...(dto.attributes === undefined ? {} : { attributes: dto.attributes }),
      ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }),
    });
  }

  async createRelationship(
    userId: string,
    projectId: string,
    dto: CreateRelationshipDto,
  ): Promise<RelationshipRecord | null> {
    if (dto.sourceEntityId === dto.targetEntityId) {
      throw new BadRequestException('Relationship entities must be different');
    }

    return this.relationshipRepository.create(userId, {
      projectId,
      sourceEntityId: dto.sourceEntityId,
      targetEntityId: dto.targetEntityId,
      relationType: dto.relationType,
      intensity: dto.intensity,
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.validFromSceneId === undefined
        ? {}
        : { validFromSceneId: dto.validFromSceneId }),
    });
  }

  async updateRelationship(
    userId: string,
    id: string,
    dto: UpdateRelationshipDto,
  ): Promise<RelationshipRecord> {
    if (
      dto.sourceEntityId !== undefined &&
      dto.targetEntityId !== undefined &&
      dto.sourceEntityId === dto.targetEntityId
    ) {
      throw new BadRequestException('Relationship entities must be different');
    }

    const relationship = await this.relationshipRepository.update(userId, id, {
      ...(dto.sourceEntityId === undefined
        ? {}
        : { sourceEntityId: dto.sourceEntityId }),
      ...(dto.targetEntityId === undefined
        ? {}
        : { targetEntityId: dto.targetEntityId }),
      ...(dto.relationType === undefined
        ? {}
        : { relationType: dto.relationType }),
      ...(dto.intensity === undefined ? {} : { intensity: dto.intensity }),
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
    });

    if (!relationship) {
      throw new NotFoundException('Relationship not found');
    }

    return relationship;
  }

  async removeRelationship(
    userId: string,
    id: string,
  ): Promise<RelationshipRecord> {
    const relationship = await this.relationshipRepository.delete(userId, id);

    if (!relationship) {
      throw new NotFoundException('Relationship not found');
    }

    return relationship;
  }

  async getEntityById(userId: string, id: string): Promise<EntityRecord> {
    const entity = await this.entityRepository.findByIdForUser(userId, id);

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async updateEntity(
    userId: string,
    id: string,
    dto: UpdateEntityDto,
  ): Promise<EntityRecord> {
    const entity = await this.entityRepository.update(userId, id, dto);

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async removeEntity(userId: string, id: string): Promise<EntityRecord> {
    const entity = await this.entityRepository.softDelete(
      userId,
      id,
      new Date(),
    );

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async listTimelineEvents(
    userId: string,
    filters: TimelineEventListFilters,
  ): Promise<TimelineEventRecord[]> {
    const events = await this.timelineEventRepository.listForProject(
      userId,
      filters,
    );
    if (!events) {
      throw new NotFoundException('Project not found');
    }
    return events;
  }

  async createTimelineEvent(
    userId: string,
    projectId: string,
    dto: CreateTimelineEventDto,
  ): Promise<TimelineEventRecord> {
    const event = await this.timelineEventRepository.createForUser(userId, {
      projectId,
      title: dto.title,
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.date === undefined ? {} : { date: dto.date }),
      ...(dto.temporalLabel === undefined
        ? {}
        : { temporalLabel: dto.temporalLabel }),
      ...(dto.impact === undefined ? {} : { impact: dto.impact }),
      ...(dto.storyboardArcId === undefined
        ? {}
        : { storyboardArcId: dto.storyboardArcId }),
      ...(dto.entityIds === undefined ? {} : { entityIds: dto.entityIds }),
      ...(dto.beforeEventId === undefined
        ? {}
        : { beforeEventId: dto.beforeEventId }),
      ...(dto.afterEventId === undefined
        ? {}
        : { afterEventId: dto.afterEventId }),
    });
    if (!event) {
      throw new NotFoundException('Project, arc, entity or position not found');
    }
    return event;
  }

  async updateTimelineEvent(
    userId: string,
    id: string,
    dto: UpdateTimelineEventDto,
  ): Promise<TimelineEventRecord> {
    const event = await this.timelineEventRepository.updateForUser(
      userId,
      id,
      dto,
    );
    if (!event) {
      throw new NotFoundException('Timeline event, arc or entity not found');
    }
    return event;
  }

  async moveTimelineEvent(
    userId: string,
    id: string,
    dto: MoveTimelineEventDto,
  ): Promise<TimelineEventRecord> {
    if (dto.beforeEventId === undefined && dto.afterEventId === undefined) {
      throw new BadRequestException('A timeline position is required');
    }
    const event = await this.timelineEventRepository.moveForUser(
      userId,
      id,
      dto.beforeEventId,
      dto.afterEventId,
    );
    if (!event) {
      throw new NotFoundException('Timeline event or position not found');
    }
    return event;
  }

  async removeTimelineEvent(
    userId: string,
    id: string,
  ): Promise<TimelineEventRecord> {
    const event = await this.timelineEventRepository.softDeleteForUser(
      userId,
      id,
      new Date(),
    );
    if (!event) {
      throw new NotFoundException('Timeline event not found');
    }
    return event;
  }
}
