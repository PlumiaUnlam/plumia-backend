import { Prisma } from '@prisma/client';
import { TimelineImpact } from '../../../src/knowledge/domain/timeline-impact';
import { PrismaTimelineEventRepository } from '../../../src/knowledge/adapters/prisma-timeline-event-repository.adapter';

describe('PrismaTimelineEventRepository', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const prisma = {
    project: { findFirst: jest.fn() },
    entity: { count: jest.fn() },
    storyboardArc: { findFirst: jest.fn() },
    scene: { findFirst: jest.fn() },
    timelineEvent: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const repository = new PrismaTimelineEventRepository(prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.entity.count.mockResolvedValue(0);
    prisma.storyboardArc.findFirst.mockResolvedValue({ id: 'arc-1' });
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-1' });
  });

  it('lists only active project events and maps their relationships', async () => {
    prisma.timelineEvent.findMany.mockResolvedValue([eventRecord()]);

    await expect(
      repository.listForProject('user-1', {
        projectId: 'project-1',
        entityId: 'entity-1',
        storyboardArcId: 'arc-1',
        impact: TimelineImpact.HIGH,
      }),
    ).resolves.toMatchObject([
      {
        id: 'event-1',
        arc: { id: 'arc-1', title: 'Arc' },
        entityIds: ['entity-1'],
        position: '1000',
        confidenceScore: 0.8,
      },
    ]);
    const listCalls = prisma.timelineEvent.findMany.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    expect(listCalls[0]?.[0].where).toEqual({
      projectId: 'project-1',
      deletedAt: null,
      impact: TimelineImpact.HIGH,
      storyboardArcId: 'arc-1',
      entities: {
        some: {
          entityId: 'entity-1',
          entity: { deletedAt: null },
        },
      },
    });

    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.listForProject('other-user', { projectId: 'project-1' }),
    ).resolves.toBeNull();
  });

  it('creates events with all optional fields and deduplicates entity links', async () => {
    prisma.entity.count.mockResolvedValue(1);
    prisma.timelineEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(eventRecord());
    prisma.timelineEvent.create.mockResolvedValue({ id: 'event-1' });

    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Meets Mara',
        description: 'Their first meeting',
        date: '2030',
        temporalLabel: 'Before the war',
        impact: TimelineImpact.HIGH,
        storyboardArcId: 'arc-1',
        entityIds: ['entity-1', 'entity-1'],
        source: 'SCENE',
        sourceSceneId: 'scene-1',
        confidenceScore: 0.8,
      }),
    ).resolves.toMatchObject({ id: 'event-1' });

    const createCalls = prisma.timelineEvent.create.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createData = createCalls[0]?.[0].data;
    expect(createData).toMatchObject({
      title: 'Meets Mara',
      description: 'Their first meeting',
      date: '2030',
      temporalLabel: 'Before the war',
      impact: TimelineImpact.HIGH,
      storyboardArcId: 'arc-1',
      source: 'SCENE',
      sourceSceneId: 'scene-1',
      confidenceScore: new Prisma.Decimal(0.8),
      entities: { create: [{ entityId: 'entity-1' }] },
    });
    expect(prisma.storyboardArc.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'arc-1',
        projectId: 'project-1',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.scene.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'scene-1',
        deletedAt: null,
        chapter: { book: { projectId: 'project-1' } },
      },
      select: { id: true },
    });
  });

  it('omits undefined optional fields and returns null for invalid create dependencies or placement', async () => {
    prisma.timelineEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(eventRecord());
    prisma.timelineEvent.create.mockResolvedValue({ id: 'event-1' });

    await repository.createForUser('user-1', {
      projectId: 'project-1',
      title: 'Standalone event',
    });
    const createCalls = prisma.timelineEvent.create.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(createCalls[0]?.[0].data).not.toHaveProperty('description');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('date');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('temporalLabel');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('impact');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('storyboardArcId');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('source');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('sourceSceneId');
    expect(createCalls[0]?.[0].data).not.toHaveProperty('confidenceScore');
    expect(createCalls[0]?.[0].data).toMatchObject({
      entities: { create: [] },
    });

    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.createForUser('user-1', {
        projectId: 'missing-project',
        title: 'No project',
      }),
    ).resolves.toBeNull();

    prisma.project.findFirst.mockResolvedValueOnce({ id: 'project-1' });
    prisma.entity.count.mockResolvedValueOnce(0);
    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Missing entity',
        entityIds: ['missing-entity'],
      }),
    ).resolves.toBeNull();

    prisma.project.findFirst.mockResolvedValueOnce({ id: 'project-1' });
    prisma.entity.count.mockResolvedValueOnce(0);
    prisma.storyboardArc.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Missing arc',
        storyboardArcId: 'missing-arc',
      }),
    ).resolves.toBeNull();

    prisma.project.findFirst.mockResolvedValueOnce({ id: 'project-1' });
    prisma.entity.count.mockResolvedValueOnce(0);
    prisma.scene.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Missing source scene',
        sourceSceneId: 'missing-scene',
      }),
    ).resolves.toBeNull();

    prisma.project.findFirst.mockResolvedValueOnce({ id: 'project-1' });
    prisma.entity.count.mockResolvedValueOnce(0);
    prisma.timelineEvent.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.createForUser('user-1', {
        projectId: 'project-1',
        title: 'Missing anchor',
        beforeEventId: 'missing-event',
      }),
    ).resolves.toBeNull();
  });

  it('updates both populated and omitted optional fields and validates entity and arc ownership', async () => {
    prisma.timelineEvent.findFirst
      .mockResolvedValueOnce({ id: 'event-1', projectId: 'project-1' })
      .mockResolvedValueOnce(eventRecord());
    prisma.entity.count.mockResolvedValue(1);

    await expect(
      repository.updateForUser('user-1', 'event-1', {
        title: 'Updated',
        description: 'Description',
        date: null,
        temporalLabel: null,
        impact: TimelineImpact.LOW,
        storyboardArcId: 'arc-1',
        entityIds: ['entity-1'],
      }),
    ).resolves.toMatchObject({ id: 'event-1' });
    const updateCalls = prisma.timelineEvent.update.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(updateCalls[0]?.[0].data).toMatchObject({
      title: 'Updated',
      description: 'Description',
      date: null,
      temporalLabel: null,
      impact: TimelineImpact.LOW,
      storyboardArcId: 'arc-1',
      entities: { deleteMany: {}, create: [{ entityId: 'entity-1' }] },
    });

    prisma.timelineEvent.findFirst
      .mockResolvedValueOnce({ id: 'event-1', projectId: 'project-1' })
      .mockResolvedValueOnce(eventRecord());
    await repository.updateForUser('user-1', 'event-1', {});
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('title');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('description');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('date');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('temporalLabel');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('impact');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('storyboardArcId');
    expect(updateCalls[1]?.[0].data).not.toHaveProperty('entities');

    prisma.timelineEvent.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.updateForUser('user-1', 'missing-event', {}),
    ).resolves.toBeNull();
    prisma.timelineEvent.findFirst.mockResolvedValueOnce({
      id: 'event-1',
      projectId: 'project-1',
    });
    prisma.entity.count.mockResolvedValueOnce(0);
    await expect(
      repository.updateForUser('user-1', 'event-1', {
        entityIds: ['missing-entity'],
      }),
    ).resolves.toBeNull();
    prisma.timelineEvent.findFirst.mockResolvedValueOnce({
      id: 'event-1',
      projectId: 'project-1',
    });
    prisma.entity.count.mockResolvedValueOnce(0);
    prisma.storyboardArc.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.updateForUser('user-1', 'event-1', {
        storyboardArcId: 'missing-arc',
      }),
    ).resolves.toBeNull();
  });

  it('moves and soft-deletes owned events and returns null for missing ones', async () => {
    prisma.timelineEvent.findFirst
      .mockResolvedValueOnce({ id: 'event-1', projectId: 'project-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(eventRecord());

    await expect(
      repository.moveForUser('user-1', 'event-1'),
    ).resolves.toMatchObject({ id: 'event-1' });
    expect(prisma.timelineEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { position: new Prisma.Decimal(1000) },
    });

    prisma.timelineEvent.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.moveForUser('user-1', 'missing-event'),
    ).resolves.toBeNull();

    prisma.timelineEvent.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.timelineEvent.findFirst.mockResolvedValueOnce(eventRecord());
    await expect(
      repository.softDeleteForUser('user-1', 'event-1', now),
    ).resolves.toMatchObject({ id: 'event-1' });
    expect(prisma.timelineEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: now } }),
    );

    prisma.timelineEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.softDeleteForUser('user-1', 'missing-event', now),
    ).resolves.toBeNull();
  });

  function eventRecord(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'event-1',
      projectId: 'project-1',
      title: 'Event',
      description: null,
      date: null,
      temporalLabel: null,
      impact: TimelineImpact.MEDIUM,
      storyboardArcId: 'arc-1',
      storyboardArc: { id: 'arc-1', title: 'Arc' },
      entities: [{ entityId: 'entity-1' }],
      position: new Prisma.Decimal(1000),
      source: 'MANUAL',
      sourceSceneId: null,
      confidenceScore: new Prisma.Decimal(0.8),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides,
    };
  }
});
