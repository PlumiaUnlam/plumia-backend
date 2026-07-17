import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
  type TimelineEventResponse,
} from '../endpoint-test-context';

describe('Knowledge timeline endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates, filters, updates and soft deletes timeline events', async () => {
    const { project, entity, targetEntity } = await ctx.createProjectTree();
    const arcResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-arcs`)
      .set(ctx.auth())
      .send({ title: 'Main arc', sourceType: 'custom' })
      .expect(201);
    const arc = responseBody<{ id: string; title: string }>(arcResponse);

    const firstResponse = await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({
        title: 'The omen',
        date: 'Mucho después',
        temporalLabel: 'Antes del viaje',
        impact: 'HIGH',
        storyboardArcId: arc.id,
        entityIds: [entity.id],
      })
      .expect(201);
    const first = responseBody<TimelineEventResponse>(firstResponse);
    expect(first).toMatchObject({
      projectId: project.id,
      date: 'Mucho después',
      impact: 'HIGH',
      storyboardArcId: arc.id,
      entityIds: [entity.id],
      source: 'author_manual',
    });
    expect(first.position).toBeDefined();

    const secondResponse = await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({
        title: 'The departure',
        beforeEventId: first.id,
        impact: 'LOW',
        entityIds: [targetEntity.id],
      })
      .expect(201);
    const second = responseBody<TimelineEventResponse>(secondResponse);

    await request(ctx.server)
      .get(
        `/knowledge/timeline?projectId=${project.id}&storyboardArcId=${arc.id}&impact=HIGH`,
      )
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<TimelineEventResponse[]>(response)).toMatchObject([
          { id: first.id },
        ]);
      });

    await request(ctx.server)
      .get(
        `/knowledge/timeline?projectId=${project.id}&entityId=${targetEntity.id}&impact=LOW`,
      )
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<TimelineEventResponse[]>(response)).toMatchObject([
          { id: second.id },
        ]);
      });

    await request(ctx.server)
      .patch(`/knowledge/timeline/${first.id}`)
      .set(ctx.auth())
      .send({
        title: 'The revised omen',
        entityIds: [entity.id, targetEntity.id],
        storyboardArcId: null,
      })
      .expect(200)
      .expect((response) => {
        const body = responseBody<TimelineEventResponse>(response);
        expect(body).toMatchObject({
          title: 'The revised omen',
          storyboardArcId: null,
        });
        expect(body.entityIds).toContain(entity.id);
        expect(body.entityIds).toContain(targetEntity.id);
      });

    await request(ctx.server)
      .delete(`/knowledge/timeline/${first.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .get(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<TimelineEventResponse[]>(response)).toEqual([
          expect.objectContaining({ id: second.id }),
        ]);
      });
  });

  it('moves an event to a relative position without using its date', async () => {
    const { project } = await ctx.createProjectTree();
    const createEvent = async (
      title: string,
    ): Promise<TimelineEventResponse> => {
      const response = await request(ctx.server)
        .post(`/knowledge/timeline?projectId=${project.id}`)
        .set(ctx.auth())
        .send({ title })
        .expect(201);
      return responseBody<TimelineEventResponse>(response);
    };
    const first = await createEvent('First');
    const second = await createEvent('Second');
    const third = await createEvent('Third');

    await request(ctx.server)
      .post(`/knowledge/timeline/${third.id}/move`)
      .set(ctx.auth())
      .send({ afterEventId: first.id, beforeEventId: second.id })
      .expect(200);

    await request(ctx.server)
      .post(`/knowledge/timeline/${first.id}/move`)
      .set(ctx.auth())
      .send({ afterEventId: second.id })
      .expect(200);

    await request(ctx.server)
      .post(`/knowledge/timeline/${first.id}/move`)
      .set(ctx.auth())
      .send({ beforeEventId: third.id })
      .expect(200);

    await request(ctx.server)
      .get(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(
          responseBody<TimelineEventResponse[]>(response).map(({ id }) => id),
        ).toEqual([first.id, third.id, second.id]);
      });
  });

  it('supports insertion at the beginning and end, and rejects foreign positions', async () => {
    const firstProject = await ctx.createProject('First project');
    const secondProject = await ctx.createProject('Second project');
    const createEvent = async (
      projectId: string,
      title: string,
      position?: { beforeEventId?: string; afterEventId?: string },
    ): Promise<TimelineEventResponse> => {
      const response = await request(ctx.server)
        .post(`/knowledge/timeline?projectId=${projectId}`)
        .set(ctx.auth())
        .send({ title, ...position })
        .expect(201);
      return responseBody<TimelineEventResponse>(response);
    };
    const first = await createEvent(firstProject.id, 'First');
    const last = await createEvent(firstProject.id, 'Last');
    const beginning = await createEvent(firstProject.id, 'Beginning', {
      beforeEventId: first.id,
    });
    const ending = await createEvent(firstProject.id, 'Ending', {
      afterEventId: last.id,
    });
    const foreign = await createEvent(secondProject.id, 'Foreign');

    await request(ctx.server)
      .get(`/knowledge/timeline?projectId=${firstProject.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(
          responseBody<TimelineEventResponse[]>(response).map(({ id }) => id),
        ).toEqual([beginning.id, first.id, last.id, ending.id]);
      });

    await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${firstProject.id}`)
      .set(ctx.auth())
      .send({ title: 'Invalid foreign position', beforeEventId: foreign.id })
      .expect(404);

    await request(ctx.server)
      .post(`/knowledge/timeline/${first.id}/move`)
      .set(ctx.auth())
      .send({ afterEventId: foreign.id })
      .expect(404);
  });

  it('does not expose or mutate a soft-deleted event', async () => {
    const { project } = await ctx.createProjectTree();
    const eventResponse = await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({ title: 'Disposable event' })
      .expect(201);
    const event = responseBody<TimelineEventResponse>(eventResponse);

    await request(ctx.server)
      .delete(`/knowledge/timeline/${event.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .patch(`/knowledge/timeline/${event.id}`)
      .set(ctx.auth())
      .send({ title: 'Should not update' })
      .expect(404);

    await request(ctx.server)
      .post(`/knowledge/timeline/${event.id}/move`)
      .set(ctx.auth())
      .send({ beforeEventId: event.id })
      .expect(404);

    await request(ctx.server)
      .delete(`/knowledge/timeline/${event.id}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('enforces ownership and validates timeline input', async () => {
    const foreignUser = await ctx.prisma.user.create({
      data: {
        id: 'foreign-timeline-user',
        name: 'Foreign',
        lastname: 'User',
        email: 'foreign-timeline@example.com',
      },
    });
    const foreignProject = await ctx.prisma.project.create({
      data: { userId: foreignUser.id, title: 'Foreign project' },
    });
    const foreignEntity = await ctx.prisma.entity.create({
      data: {
        projectId: foreignProject.id,
        canonicalName: 'Foreign entity',
        type: 'CHARACTER',
      },
    });
    const foreignArc = await ctx.prisma.storyboardArc.create({
      data: {
        projectId: foreignProject.id,
        title: 'Foreign arc',
        sortKey: '000001',
      },
    });

    await request(ctx.server)
      .get(`/knowledge/timeline?projectId=${foreignProject.id}`)
      .set(ctx.auth())
      .expect(404);

    const project = await ctx.createProject();
    await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({
        title: 'Foreign references',
        storyboardArcId: foreignArc.id,
        entityIds: [foreignEntity.id],
      })
      .expect(404);

    const ownEventResponse = await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({ title: 'Own event' })
      .expect(201);
    const ownEvent = responseBody<TimelineEventResponse>(ownEventResponse);

    await request(ctx.server)
      .patch(`/knowledge/timeline/${ownEvent.id}`)
      .set(ctx.auth())
      .send({ storyboardArcId: foreignArc.id })
      .expect(404);

    await request(ctx.server)
      .patch(`/knowledge/timeline/${ownEvent.id}`)
      .set(ctx.auth())
      .send({ entityIds: [foreignEntity.id] })
      .expect(404);

    await request(ctx.server)
      .post(`/knowledge/timeline?projectId=${project.id}`)
      .set(ctx.auth())
      .send({ title: 'Invalid', impact: 'SEVERE' })
      .expect(400);

    await request(ctx.server)
      .post(`/knowledge/timeline/${missingUuid}/move`)
      .set(ctx.auth())
      .send({})
      .expect(400);
  });
});
