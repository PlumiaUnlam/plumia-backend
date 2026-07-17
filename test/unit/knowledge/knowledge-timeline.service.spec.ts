import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeService } from '../../../src/knowledge/knowledge.service';
import { TimelineImpact } from '../../../src/knowledge/domain/timeline-impact';
import type {
  TimelineEventRecord,
  TimelineEventRepository,
} from '../../../src/knowledge/ports/timeline-event-repository.port';

describe('KnowledgeService timeline events', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  const event: TimelineEventRecord = {
    id: 'event-1',
    projectId: 'project-1',
    title: 'The omen',
    description: null,
    date: '1887-10-14',
    temporalLabel: 'At dawn',
    impact: TimelineImpact.HIGH,
    storyboardArcId: 'arc-1',
    arc: { id: 'arc-1', title: 'Main arc' },
    entityIds: ['entity-1'],
    position: '1000',
    source: 'author_manual',
    sourceSceneId: null,
    confidenceScore: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  let timelineRepository: jest.Mocked<TimelineEventRepository>;
  let service: KnowledgeService;

  beforeEach(() => {
    timelineRepository = {
      listForProject: jest.fn(),
      createForUser: jest.fn(),
      updateForUser: jest.fn(),
      moveForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
    };
    service = new KnowledgeService(
      { searchByName: jest.fn() },
      {} as never,
      {} as never,
      timelineRepository,
    );
  });

  it('creates a manual event with free temporal text and editorial placement', async () => {
    timelineRepository.createForUser.mockResolvedValue(event);

    await expect(
      service.createTimelineEvent('user-1', 'project-1', {
        title: 'The omen',
        date: '1887-10-14',
        temporalLabel: 'At dawn',
        impact: TimelineImpact.HIGH,
        storyboardArcId: 'arc-1',
        entityIds: ['entity-1'],
        beforeEventId: 'event-2',
        afterEventId: 'event-3',
      }),
    ).resolves.toEqual(event);

    expect(timelineRepository.createForUser).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      title: 'The omen',
      date: '1887-10-14',
      temporalLabel: 'At dawn',
      impact: TimelineImpact.HIGH,
      storyboardArcId: 'arc-1',
      entityIds: ['entity-1'],
      beforeEventId: 'event-2',
      afterEventId: 'event-3',
    });
  });

  it('moves an event using relative neighbours and rejects an empty position', async () => {
    timelineRepository.moveForUser.mockResolvedValue(event);

    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {
        beforeEventId: 'event-2',
        afterEventId: 'event-3',
      }),
    ).resolves.toEqual(event);
    expect(timelineRepository.moveForUser).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      'event-2',
      'event-3',
    );

    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists, updates and soft deletes only through the timeline repository', async () => {
    timelineRepository.listForProject.mockResolvedValue([event]);
    timelineRepository.updateForUser.mockResolvedValue({
      ...event,
      title: 'Revised omen',
      storyboardArcId: null,
      arc: null,
    });
    timelineRepository.softDeleteForUser.mockResolvedValue(event);

    await expect(
      service.listTimelineEvents('user-1', {
        projectId: 'project-1',
        entityId: 'entity-1',
        storyboardArcId: 'arc-1',
        impact: TimelineImpact.HIGH,
      }),
    ).resolves.toEqual([event]);
    expect(timelineRepository.listForProject).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      entityId: 'entity-1',
      storyboardArcId: 'arc-1',
      impact: TimelineImpact.HIGH,
    });

    await expect(
      service.updateTimelineEvent('user-1', 'event-1', {
        title: 'Revised omen',
        storyboardArcId: null,
      }),
    ).resolves.toMatchObject({ title: 'Revised omen', storyboardArcId: null });
    expect(timelineRepository.updateForUser).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      { title: 'Revised omen', storyboardArcId: null },
    );

    await expect(
      service.removeTimelineEvent('user-1', 'event-1'),
    ).resolves.toEqual(event);
    expect(timelineRepository.softDeleteForUser).toHaveBeenCalledWith(
      'user-1',
      'event-1',
      expect.any(Date),
    );
  });

  it('translates missing timeline resources into not found errors', async () => {
    timelineRepository.listForProject.mockResolvedValue(null);
    timelineRepository.createForUser.mockResolvedValue(null);
    timelineRepository.updateForUser.mockResolvedValue(null);
    timelineRepository.moveForUser.mockResolvedValue(null);
    timelineRepository.softDeleteForUser.mockResolvedValue(null);

    await expect(
      service.listTimelineEvents('user-1', { projectId: 'project-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createTimelineEvent('user-1', 'project-1', { title: 'Missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.moveTimelineEvent('user-1', 'event-1', {
        beforeEventId: 'event-2',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateTimelineEvent('user-1', 'event-1', { title: 'Missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeTimelineEvent('user-1', 'event-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
