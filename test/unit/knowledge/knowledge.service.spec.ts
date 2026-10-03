import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeService } from '../../../src/knowledge/knowledge.service';
import { EntityType } from '../../../src/knowledge/domain/entity-type';
import { RelationType } from '../../../src/knowledge/domain/relation-type';
import { TimelineImpact } from '../../../src/knowledge/domain/timeline-impact';
import type {
  EntityRepository,
  EntityRecord,
} from '../../../src/knowledge/ports/entity-repository.port';
import type {
  RelationshipRecord,
  RelationshipRepository,
} from '../../../src/knowledge/ports/relationship-repository.port';
import type {
  TimelineEventRecord,
  TimelineEventRepository,
} from '../../../src/knowledge/ports/timeline-event-repository.port';
import type { EntitySearch } from '../../../src/knowledge/ports/entity-search.port';

describe('KnowledgeService', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const entity: EntityRecord = {
    id: 'entity-1',
    projectId: 'project-1',
    canonicalName: 'Mara',
    aliases: [],
    type: EntityType.CHARACTER,
    description: null,
    attributes: {},
    imageUrl: null,
    confidenceScore: 1,
    source: 'manual',
    userLockedFields: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const relationship: RelationshipRecord = {
    id: 'relationship-1',
    projectId: 'project-1',
    sourceEntityId: 'entity-1',
    targetEntityId: 'entity-2',
    relationType: RelationType.ALLY,
    intensity: 1,
    description: null,
    createdAt: now,
    updatedAt: now,
  };
  const event: TimelineEventRecord = {
    id: 'event-1',
    projectId: 'project-1',
    title: 'Meets Mara',
    description: null,
    date: null,
    temporalLabel: null,
    impact: TimelineImpact.MEDIUM,
    storyboardArcId: null,
    arc: null,
    entityIds: ['entity-1'],
    position: '000001',
    source: 'MANUAL',
    sourceSceneId: null,
    confidenceScore: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  let entitySearch: jest.Mocked<EntitySearch>;
  let entities: jest.Mocked<EntityRepository>;
  let relationships: jest.Mocked<RelationshipRepository>;
  let timeline: jest.Mocked<TimelineEventRepository>;
  let service: KnowledgeService;

  beforeEach(() => {
    entitySearch = { searchByName: jest.fn() };
    entities = {
      list: jest.fn(),
      count: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    relationships = {
      listByProject: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    timeline = {
      listForProject: jest.fn(),
      createForUser: jest.fn(),
      updateForUser: jest.fn(),
      moveForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
    };
    service = new KnowledgeService(
      entitySearch,
      entities,
      relationships,
      timeline,
    );
  });

  it('searches and lists entities using the requested project filters', async () => {
    entitySearch.searchByName.mockResolvedValue([
      { entityId: 'entity-1', canonicalName: 'Mara', score: 0.9 },
    ]);
    entities.list.mockResolvedValue([entity]);
    await expect(service.searchEntities('project-1', 'Mar')).resolves.toEqual([
      { entityId: 'entity-1', canonicalName: 'Mara', score: 0.9 },
    ]);
    await expect(
      service.searchEntities('project-1', 'Mar', 4),
    ).resolves.toEqual([
      { entityId: 'entity-1', canonicalName: 'Mara', score: 0.9 },
    ]);
    expect(entitySearch.searchByName).toHaveBeenNthCalledWith(1, {
      projectId: 'project-1',
      query: 'Mar',
      limit: 10,
    });
    expect(entitySearch.searchByName).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      query: 'Mar',
      limit: 4,
    });
    await expect(
      service.listEntities({
        projectId: 'project-1',
        type: EntityType.CHARACTER,
      }),
    ).resolves.toEqual([entity]);
    expect(entities.list).toHaveBeenCalledWith({
      projectId: 'project-1',
      type: EntityType.CHARACTER,
    });
  });

  it('creates, loads, updates, and removes worldbuilding entities', async () => {
    entities.create.mockResolvedValue(entity);
    const dto = {
      canonicalName: 'Mara',
      type: EntityType.CHARACTER,
      description: 'Cartographer',
      aliases: ['Captain'],
      attributes: { hair: 'black' },
      imageUrl: 'https://img/mara.png',
    };
    await expect(
      service.createEntity('user-1', 'project-1', dto),
    ).resolves.toEqual(entity);
    expect(entities.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      canonicalName: 'Mara',
      type: EntityType.CHARACTER,
      description: 'Cartographer',
      aliases: ['Captain'],
      attributes: { hair: 'black' },
      imageUrl: 'https://img/mara.png',
    });
    await service.createEntity('user-1', 'project-1', {
      canonicalName: 'Mara',
      type: EntityType.CHARACTER,
    });
    expect(entities.create).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      canonicalName: 'Mara',
      type: EntityType.CHARACTER,
    });

    entities.findByIdForUser.mockResolvedValue(entity);
    await expect(service.getEntityById('user-1', 'entity-1')).resolves.toEqual(
      entity,
    );
    entities.update.mockResolvedValue(entity);
    await expect(
      service.updateEntity('user-1', 'entity-1', { description: 'Updated' }),
    ).resolves.toEqual(entity);
    expect(entities.update).toHaveBeenCalledWith('user-1', 'entity-1', {
      description: 'Updated',
    });
    entities.softDelete.mockResolvedValue({ ...entity, deletedAt: now });
    await expect(
      service.removeEntity('user-1', 'entity-1'),
    ).resolves.toMatchObject({ deletedAt: now });
    expect(entities.softDelete).toHaveBeenCalledWith(
      'user-1',
      'entity-1',
      expect.any(Date),
    );

    entities.findByIdForUser.mockResolvedValue(null);
    entities.update.mockResolvedValue(null);
    entities.softDelete.mockResolvedValue(null);
    await expect(service.getEntityById('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
    await expect(service.updateEntity('user-1', 'missing', {})).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
    await expect(service.removeEntity('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
  });

  it('creates relationships only between distinct entities and updates only supplied fields', async () => {
    relationships.create.mockResolvedValue(relationship);
    const dto = {
      sourceEntityId: 'entity-1',
      targetEntityId: 'entity-2',
      relationType: RelationType.ALLY,
      intensity: 0.8,
      description: 'Trust each other',
      validFromSceneId: 'scene-1',
    };
    await expect(
      service.createRelationship('user-1', 'project-1', dto),
    ).resolves.toEqual(relationship);
    expect(relationships.create).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      ...dto,
    });
    await service.createRelationship('user-1', 'project-1', {
      sourceEntityId: 'entity-1',
      targetEntityId: 'entity-2',
      relationType: RelationType.ALLY,
      intensity: 1,
    });
    expect(relationships.create).toHaveBeenLastCalledWith('user-1', {
      projectId: 'project-1',
      sourceEntityId: 'entity-1',
      targetEntityId: 'entity-2',
      relationType: RelationType.ALLY,
      intensity: 1,
    });
    await expect(
      service.createRelationship('user-1', 'project-1', {
        ...dto,
        targetEntityId: 'entity-1',
      }),
    ).rejects.toThrow(
      new BadRequestException('Relationship entities must be different'),
    );

    relationships.listByProject.mockResolvedValue([relationship]);
    await expect(
      service.listRelationships('user-1', 'project-1'),
    ).resolves.toEqual([relationship]);
    expect(relationships.listByProject).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    relationships.update.mockResolvedValue(relationship);
    await expect(
      service.updateRelationship('user-1', 'relationship-1', {
        intensity: 0.4,
      }),
    ).resolves.toEqual(relationship);
    expect(relationships.update).toHaveBeenCalledWith(
      'user-1',
      'relationship-1',
      { intensity: 0.4 },
    );
    await expect(
      service.updateRelationship('user-1', 'relationship-1', {
        sourceEntityId: 'x',
        targetEntityId: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
    relationships.update.mockResolvedValue(null);
    await expect(
      service.updateRelationship('user-1', 'missing', {}),
    ).rejects.toThrow(new NotFoundException('Relationship not found'));
    relationships.delete.mockResolvedValue(relationship);
    await expect(
      service.removeRelationship('user-1', 'relationship-1'),
    ).resolves.toEqual(relationship);
    relationships.delete.mockResolvedValue(null);
    await expect(
      service.removeRelationship('user-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Relationship not found'));
  });

  it('creates, lists, updates, moves, and removes timeline events', async () => {
    timeline.listForProject.mockResolvedValue([event]);
    await expect(
      service.listTimelineEvents('user-1', {
        projectId: 'project-1',
        impact: TimelineImpact.MEDIUM,
      }),
    ).resolves.toEqual([event]);
    timeline.listForProject.mockResolvedValue(null);
    await expect(
      service.listTimelineEvents('user-1', { projectId: 'missing' }),
    ).rejects.toThrow(new NotFoundException('Project not found'));

    timeline.createForUser.mockResolvedValue(event);
    const dto = {
      title: 'Meets Mara',
      description: 'At the port',
      date: '2040-04-01',
      temporalLabel: 'Spring',
      impact: TimelineImpact.HIGH,
      storyboardArcId: 'arc-1',
      entityIds: ['entity-1'],
      beforeEventId: 'event-2',
      afterEventId: 'event-3',
    };
    await expect(
      service.createTimelineEvent('user-1', 'project-1', dto),
    ).resolves.toEqual(event);
    expect(timeline.createForUser).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      ...dto,
    });
    timeline.createForUser.mockResolvedValue(null);
    await expect(
      service.createTimelineEvent('user-1', 'project-1', { title: 'Missing' }),
    ).rejects.toThrow(
      new NotFoundException('Project, arc, entity or position not found'),
    );

    timeline.updateForUser.mockResolvedValue(event);
    await expect(
      service.updateTimelineEvent('user-1', 'event-1', { title: 'Changed' }),
    ).resolves.toEqual(event);
    timeline.updateForUser.mockResolvedValue(null);
    await expect(
      service.updateTimelineEvent('user-1', 'missing', {}),
    ).rejects.toThrow(
      new NotFoundException('Timeline event, arc or entity not found'),
    );

    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {}),
    ).rejects.toThrow(
      new BadRequestException('A timeline position is required'),
    );
    timeline.moveForUser.mockResolvedValue(event);
    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {
        afterEventId: 'event-2',
      }),
    ).resolves.toEqual(event);
    expect(timeline.moveForUser).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      undefined,
      'event-2',
    );
    timeline.moveForUser.mockResolvedValue(null);
    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {
        beforeEventId: 'event-2',
      }),
    ).rejects.toThrow(
      new NotFoundException('Timeline event or position not found'),
    );

    timeline.softDeleteForUser.mockResolvedValue(event);
    await expect(
      service.removeTimelineEvent('user-1', 'event-1'),
    ).resolves.toEqual(event);
    expect(timeline.softDeleteForUser).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      expect.any(Date),
    );
    timeline.softDeleteForUser.mockResolvedValue(null);
    await expect(
      service.removeTimelineEvent('user-1', 'missing'),
    ).rejects.toThrow(new NotFoundException('Timeline event not found'));
  });
});
