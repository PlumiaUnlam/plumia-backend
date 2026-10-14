import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
} from '../endpoint-test-context';

interface AnnotationResponse {
  id: string;
  body: string;
  quote: string | null;
  isResolved?: boolean;
}

describe('Author annotation endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates, lists, updates, resolves, reopens, and removes an anchored annotation', async () => {
    const { scene } = await ctx.createProjectTree();
    const created = await request(ctx.server)
      .post(`/scenes/${scene.id}/annotations`)
      .set(ctx.auth())
      .send({
        body: '  Clarify the clue.  ',
        quote: '  the silver key  ',
        anchorFrom: 4,
        anchorTo: 18,
        contextBefore: 'before',
        contextAfter: 'after',
      })
      .expect(201)
      .then((response) => responseBody<AnnotationResponse>(response));

    expect(created.id).toBeTruthy();
    expect(created).toMatchObject({
      body: 'Clarify the clue.',
      quote: 'the silver key',
    });

    await request(ctx.server)
      .get(`/scenes/${scene.id}/annotations`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const annotations = responseBody<AnnotationResponse[]>(response);
        expect(annotations.map((annotation) => annotation.id)).toContain(
          created.id,
        );
      });

    await request(ctx.server)
      .patch(`/scenes/${scene.id}/annotations/${created.id}`)
      .set(ctx.auth())
      .send({ body: 'Revised clue.' })
      .expect(200)
      .expect((response) => {
        expect(responseBody<AnnotationResponse>(response).body).toBe(
          'Revised clue.',
        );
      });

    await request(ctx.server)
      .patch(`/scenes/${scene.id}/annotations/${created.id}`)
      .set(ctx.auth())
      .send({ isResolved: true })
      .expect(200);

    await request(ctx.server)
      .patch(`/scenes/${scene.id}/annotations/${created.id}`)
      .set(ctx.auth())
      .send({ isResolved: false })
      .expect(200);

    await request(ctx.server)
      .delete(`/scenes/${scene.id}/annotations/${created.id}`)
      .set(ctx.auth())
      .expect(204);

    await request(ctx.server)
      .get(`/scenes/${scene.id}/annotations`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<AnnotationResponse[]>(response)).toEqual([]);
      });
  });

  it('rejects invalid annotation anchors and unauthenticated requests', async () => {
    const { scene } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/scenes/${scene.id}/annotations`)
      .set(ctx.auth())
      .send({ body: 'Invalid', quote: 'text', anchorFrom: 1 })
      .expect(400);

    await request(ctx.server)
      .get(`/scenes/${scene.id}/annotations`)
      .expect(401);

    await request(ctx.server)
      .get(`/scenes/${missingUuid}/annotations`)
      .set(ctx.auth())
      .expect(404);
  });
});
