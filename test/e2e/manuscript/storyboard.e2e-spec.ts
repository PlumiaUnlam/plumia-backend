import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
  type StoryboardArcResponse,
  type StoryboardCardResponse,
  type StoryboardMatrixNoteResponse,
} from '../endpoint-test-context';

describe('Storyboard endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates, lists, updates and deletes storyboard cards', async () => {
    const { project, chapter, entity } = await ctx.createProjectTree();

    const createResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .send({
        title: 'Opening beat',
        description: 'Introduce the central promise',
        status: 'planned',
        tags: ['setup'],
        characters: ['Hero'],
        entityIds: [entity.id],
        chapterId: chapter.id,
      })
      .expect(201);

    const card = responseBody<StoryboardCardResponse>(createResponse);
    expect(card).toMatchObject({
      projectId: project.id,
      chapterId: chapter.id,
      title: 'Opening beat',
      status: 'planned',
      entityIds: [entity.id],
    });

    await request(ctx.server)
      .get(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse[]>(response);
        expect(body.some((item) => item.id === card.id)).toBe(true);
      });

    await request(ctx.server)
      .patch(`/storyboard-cards/${card.id}`)
      .set(ctx.auth())
      .send({ title: 'Revised beat', status: 'in-progress' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse>(response);
        expect(body).toMatchObject({
          id: card.id,
          title: 'Revised beat',
          status: 'in-progress',
        });
      });

    await request(ctx.server)
      .delete(`/storyboard-cards/${card.id}`)
      .set(ctx.auth())
      .expect(204);
  });

  it('creates, lists, updates and deletes storyboard matrix arcs and notes', async () => {
    const { project, chapter, entity } = await ctx.createProjectTree();

    const arcResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-arcs`)
      .set(ctx.auth())
      .send({
        title: 'Hero arc',
        sourceType: 'entity',
        entityId: entity.id,
      })
      .expect(201);

    const arc = responseBody<StoryboardArcResponse>(arcResponse);
    expect(arc).toMatchObject({
      projectId: project.id,
      title: 'Hero arc',
      sourceType: 'entity',
      entityId: entity.id,
    });

    const noteResponse = await request(ctx.server)
      .post(`/storyboard-arcs/${arc.id}/notes`)
      .set(ctx.auth())
      .send({ chapterId: chapter.id, content: 'Learns the cost of hiding' })
      .expect(201);

    const note = responseBody<StoryboardMatrixNoteResponse>(noteResponse);
    expect(note).toMatchObject({
      arcId: arc.id,
      chapterId: chapter.id,
      content: 'Learns the cost of hiding',
    });

    await request(ctx.server)
      .get(`/projects/${project.id}/storyboard-arcs`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardArcResponse[]>(response);
        const firstArc = body[0];
        if (!firstArc) {
          throw new Error('Expected the storyboard arc to be listed');
        }
        expect(firstArc).toMatchObject({ id: arc.id });
        const firstNote = firstArc.notes[0];
        if (!firstNote) {
          throw new Error('Expected the storyboard arc to contain a note');
        }
        expect(firstNote).toMatchObject({ id: note.id });
      });

    await request(ctx.server)
      .patch(`/storyboard-matrix-notes/${note.id}`)
      .set(ctx.auth())
      .send({ content: 'Chooses the hard truth' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardMatrixNoteResponse>(response);
        expect(body).toMatchObject({
          id: note.id,
          content: 'Chooses the hard truth',
        });
      });

    await request(ctx.server)
      .delete(`/storyboard-matrix-notes/${note.id}`)
      .set(ctx.auth())
      .expect(204);

    await request(ctx.server)
      .delete(`/storyboard-arcs/${arc.id}`)
      .set(ctx.auth())
      .expect(204);
  });
});
