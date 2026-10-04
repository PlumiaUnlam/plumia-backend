import { NotFoundException } from '@nestjs/common';
import { EntityType } from '../../../src/knowledge/domain/entity-type';
import { RelationType } from '../../../src/knowledge/domain/relation-type';
import { TimelineImpact } from '../../../src/knowledge/domain/timeline-impact';
import { EntitiesController } from '../../../src/knowledge/controllers/entities.controller';
import { EntityProposalsController } from '../../../src/knowledge/controllers/entity-proposals.controller';
import { RelationshipProposalsController } from '../../../src/knowledge/controllers/relationship-proposals.controller';
import { RelationshipsController } from '../../../src/knowledge/controllers/relationships.controller';
import { TimelineController } from '../../../src/knowledge/controllers/timeline.controller';
import type { AuthenticatedRequest } from '../../../src/knowledge/controllers/authenticated-request';

const req = { user: { id: 'user-1' } } as AuthenticatedRequest;
const now = new Date('2026-09-01T00:00:00.000Z');
const entity = {
  id: 'entity-1',
  projectId: 'project-1',
  canonicalName: 'Mara',
  aliases: [],
  type: EntityType.CHARACTER,
  description: null,
  attributes: {},
  imageUrl: null,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};
const relationship = {
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
const timelineEvent = {
  id: 'event-1',
  projectId: 'project-1',
  title: 'Meets Mara',
  description: null,
  date: null,
  temporalLabel: 'Before the war',
  impact: TimelineImpact.HIGH,
  storyboardArcId: null,
  arc: null,
  entityIds: ['entity-1'],
  position: '001',
  source: 'MANUAL',
  sourceSceneId: null,
  confidenceScore: 1,
  createdAt: now,
  updatedAt: now,
};

describe('knowledge controllers', () => {
  it('supports entity list filters and authenticated entity CRUD', async () => {
    const service = {
      listEntities: jest.fn().mockResolvedValue([entity]),
      createEntity: jest.fn().mockResolvedValue(entity),
      getEntityById: jest.fn().mockResolvedValue(entity),
      updateEntity: jest.fn().mockResolvedValue(entity),
      removeEntity: jest.fn().mockResolvedValue(entity),
    };
    const controller = new EntitiesController(service as never);
    const dto = { canonicalName: 'Mara', type: EntityType.CHARACTER };

    await expect(
      controller.listEntities(req, 'project-1'),
    ).resolves.toMatchObject([{ id: 'entity-1' }]);
    expect(service.listEntities).toHaveBeenNthCalledWith(1, {
      projectId: 'project-1',
    });
    await controller.listEntities(req, 'project-1', 'Mara', 'CHARACTER', '15');
    expect(service.listEntities).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      search: 'Mara',
      type: 'CHARACTER',
      limit: 15,
    });
    await controller.listEntities(
      req,
      'project-1',
      undefined,
      undefined,
      'not-a-number',
    );
    expect(service.listEntities).toHaveBeenNthCalledWith(3, {
      projectId: 'project-1',
      limit: Number.NaN,
    });
    await expect(
      controller.createEntity(req, 'project-1', dto as never),
    ).resolves.toMatchObject({ id: 'entity-1' });
    await expect(
      controller.getEntityById(req, 'entity-1'),
    ).resolves.toMatchObject({ canonicalName: 'Mara' });
    await expect(
      controller.updateEntity(req, 'entity-1', { description: 'Changed' }),
    ).resolves.toMatchObject({ id: 'entity-1' });
    await expect(
      controller.removeEntity(req, 'entity-1'),
    ).resolves.toMatchObject({ id: 'entity-1' });
    expect(service.createEntity).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      dto,
    );
    expect(service.getEntityById).toHaveBeenCalledWith('user-1', 'entity-1');
    expect(service.updateEntity).toHaveBeenCalledWith('user-1', 'entity-1', {
      description: 'Changed',
    });
    expect(service.removeEntity).toHaveBeenCalledWith('user-1', 'entity-1');
  });

  it('supports relationship listing and CRUD, including missing related records', async () => {
    const service = {
      listRelationships: jest.fn().mockResolvedValue([relationship]),
      createRelationship: jest.fn().mockResolvedValue(relationship),
      updateRelationship: jest.fn().mockResolvedValue(relationship),
      removeRelationship: jest.fn().mockResolvedValue(relationship),
    };
    const controller = new RelationshipsController(service as never);
    const dto = {
      sourceEntityId: 'entity-1',
      targetEntityId: 'entity-2',
      relationType: RelationType.ALLY,
    };

    await expect(
      controller.listRelationships(req, 'project-1'),
    ).resolves.toMatchObject([{ id: 'relationship-1' }]);
    expect(service.listRelationships).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      undefined,
    );
    await expect(
      controller.createRelationship(req, 'project-1', dto as never),
    ).resolves.toMatchObject({ id: 'relationship-1' });
    service.createRelationship.mockResolvedValue(null);
    await expect(
      controller.createRelationship(req, 'project-1', dto as never),
    ).rejects.toThrow(new NotFoundException('Project or entity not found'));
    await expect(
      controller.updateRelationship(req, 'relationship-1', { intensity: 2 }),
    ).resolves.toMatchObject({ id: 'relationship-1' });
    await expect(
      controller.removeRelationship(req, 'relationship-1'),
    ).resolves.toMatchObject({ id: 'relationship-1' });
    expect(service.createRelationship).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      dto,
    );
    expect(service.updateRelationship).toHaveBeenCalledWith(
      'user-1',
      'relationship-1',
      { intensity: 2 },
    );
    expect(service.removeRelationship).toHaveBeenCalledWith(
      'user-1',
      'relationship-1',
    );
  });

  it('maps timeline filters and event create, update, move, and remove operations', async () => {
    const service = {
      listTimelineEvents: jest.fn().mockResolvedValue([timelineEvent]),
      createTimelineEvent: jest.fn().mockResolvedValue(timelineEvent),
      updateTimelineEvent: jest.fn().mockResolvedValue(timelineEvent),
      moveTimelineEvent: jest.fn().mockResolvedValue(timelineEvent),
      removeTimelineEvent: jest.fn().mockResolvedValue(timelineEvent),
    };
    const controller = new TimelineController(service as never);
    const createDto = { title: 'Meets Mara', impact: TimelineImpact.HIGH };

    await expect(
      controller.listTimelineEvents(req, 'project-1'),
    ).resolves.toMatchObject([{ id: 'event-1', createdAt: now.toISOString() }]);
    expect(service.listTimelineEvents).toHaveBeenNthCalledWith(1, 'user-1', {
      projectId: 'project-1',
    });
    await controller.listTimelineEvents(
      req,
      'project-1',
      'entity-1',
      'arc-1',
      TimelineImpact.HIGH,
    );
    expect(service.listTimelineEvents).toHaveBeenNthCalledWith(2, 'user-1', {
      projectId: 'project-1',
      entityId: 'entity-1',
      storyboardArcId: 'arc-1',
      impact: TimelineImpact.HIGH,
    });
    await expect(
      controller.createTimelineEvent(req, 'project-1', createDto as never),
    ).resolves.toMatchObject({ id: 'event-1' });
    await expect(
      controller.updateTimelineEvent(req, 'event-1', { title: 'Updated' }),
    ).resolves.toMatchObject({ id: 'event-1' });
    await expect(
      controller.moveTimelineEvent(req, 'event-1', {
        position: '002',
      } as never),
    ).resolves.toMatchObject({ id: 'event-1' });
    await expect(
      controller.removeTimelineEvent(req, 'event-1'),
    ).resolves.toMatchObject({ id: 'event-1' });
    expect(service.createTimelineEvent).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      createDto,
    );
    expect(service.updateTimelineEvent).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      { title: 'Updated' },
    );
    expect(service.moveTimelineEvent).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      { position: '002' },
    );
    expect(service.removeTimelineEvent).toHaveBeenCalledWith(
      'user-1',
      'event-1',
    );
  });

  it('routes entity proposal listing, acceptance overrides, and rejection', async () => {
    const proposalService = {
      listPendingByProject: jest.fn().mockResolvedValue([{ id: 'proposal-1' }]),
      acceptProposal: jest.fn().mockResolvedValue(entity),
      rejectProposal: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new EntityProposalsController(proposalService as never);
    const override = { canonicalName: 'Mara Voss' };

    await expect(
      controller.listProjectProposals(req, 'project-1'),
    ).resolves.toEqual([{ id: 'proposal-1' }]);
    await expect(
      controller.acceptProposal(req, 'proposal-1', override as never),
    ).resolves.toEqual(entity);
    await expect(controller.acceptProposal(req, 'proposal-1')).resolves.toEqual(
      entity,
    );
    await expect(
      controller.rejectProposal(req, 'proposal-1'),
    ).resolves.toBeUndefined();
    expect(proposalService.listPendingByProject).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    expect(proposalService.acceptProposal).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'proposal-1',
      override,
    );
    expect(proposalService.acceptProposal).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'proposal-1',
      undefined,
    );
    expect(proposalService.rejectProposal).toHaveBeenCalledWith(
      'user-1',
      'proposal-1',
    );
  });

  it('routes relationship proposal listing, acceptance overrides, and rejection', async () => {
    const accepted = { id: 'relationship-1' };
    const proposalService = {
      listPendingByProject: jest.fn().mockResolvedValue([{ id: 'proposal-1' }]),
      acceptProposal: jest.fn().mockResolvedValue(accepted),
      rejectProposal: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new RelationshipProposalsController(
      proposalService as never,
    );
    const override = { relationType: RelationType.FAMILY };

    await expect(controller.list(req, 'project-1')).resolves.toEqual([
      { id: 'proposal-1' },
    ]);
    await expect(
      controller.accept(req, 'proposal-1', override as never),
    ).resolves.toEqual(accepted);
    await expect(controller.accept(req, 'proposal-1')).resolves.toEqual(
      accepted,
    );
    await expect(controller.reject(req, 'proposal-1')).resolves.toBeUndefined();
    expect(proposalService.listPendingByProject).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    expect(proposalService.acceptProposal).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'proposal-1',
      override,
    );
    expect(proposalService.acceptProposal).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'proposal-1',
      undefined,
    );
    expect(proposalService.rejectProposal).toHaveBeenCalledWith(
      'user-1',
      'proposal-1',
    );
  });
});
