import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
  type RelationshipResponse,
} from '../endpoint-test-context';

describe('Knowledge relationship endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates, lists, updates and deletes relationships', async () => {
    const { project, entity, targetEntity } = await ctx.createProjectTree();
    const relationship = await ctx.createRelationship(
      project.id,
      entity.id,
      targetEntity.id,
    );

    await request(ctx.server)
      .get(`/knowledge/relationships?projectId=${project.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<RelationshipResponse[]>(response);
        expect(body.some((item) => item.id === relationship.id)).toBe(true);
      });

    await request(ctx.server)
      .patch(`/knowledge/relationships/${relationship.id}`)
      .set(ctx.auth())
      .send({ relationType: 'ALLY', intensity: 4 })
      .expect(200)
      .expect((response) => {
        const body = responseBody<RelationshipResponse>(response);
        expect(body).toMatchObject({ relationType: 'ALLY' });
      });

    await request(ctx.server)
      .delete(`/knowledge/relationships/${relationship.id}`)
      .set(ctx.auth())
      .expect(200);
  });

  it('validates relationship ids and missing data', async () => {
    const { project, entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/knowledge/relationships?projectId=${project.id}`)
      .set(ctx.auth())
      .send({
        sourceEntityId: entity.id,
        targetEntityId: missingUuid,
        relationType: 'KNOWS',
        intensity: 3,
      })
      .expect(404);

    await request(ctx.server)
      .patch('/knowledge/relationships/not-a-uuid')
      .set(ctx.auth())
      .send({ relationType: 'ALLY' })
      .expect(400);

    await request(ctx.server)
      .delete(`/knowledge/relationships/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);
  });
});
