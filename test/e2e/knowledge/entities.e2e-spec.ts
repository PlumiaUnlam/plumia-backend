import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
  type EntityResponse,
} from '../endpoint-test-context';

describe('Knowledge entity endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates an entity', async () => {
    const project = await ctx.createProject();
    const entity = await ctx.createEntity(project.id);

    expect(entity).toMatchObject({
      projectId: project.id,
      canonicalName: 'Entity',
      type: 'CHARACTER',
      isActive: true,
    });
  });

  it('lists and filters entities by project, type and search', async () => {
    const { project, entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .get(
        `/knowledge/entities?projectId=${project.id}&type=CHARACTER&search=Entity`,
      )
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<EntityResponse[]>(response);
        expect(body.some((item) => item.id === entity.id)).toBe(true);
      });
  });

  it('returns an entity detail', async () => {
    const { entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .get(`/knowledge/entities/${entity.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<EntityResponse>(response);
        expect(body).toMatchObject({ id: entity.id });
      });
  });

  it('updates an entity', async () => {
    const { entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .patch(`/knowledge/entities/${entity.id}`)
      .set(ctx.auth())
      .send({
        canonicalName: 'Updated Entity',
        aliases: ['Updated Alias'],
        attributes: { role: 'guide' },
        imageUrl: 'https://cdn.test/updated-wiki-entity.png',
        isActive: false,
      })
      .expect(200)
      .expect((response) => {
        const body = responseBody<EntityResponse>(response);
        expect(body).toMatchObject({
          canonicalName: 'Updated Entity',
          aliases: ['Updated Alias'],
          attributes: { role: 'guide' },
          imageUrl: 'https://cdn.test/updated-wiki-entity.png',
          isActive: false,
        });
      });
  });

  it('soft deletes an entity', async () => {
    const { entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .delete(`/knowledge/entities/${entity.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .get(`/knowledge/entities/${entity.id}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('validates entity payloads and ids', async () => {
    const { project, entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/knowledge/entities?projectId=${project.id}`)
      .set(ctx.auth())
      .send({ canonicalName: 'Invalid Entity', type: 'INVALID' })
      .expect(400);

    await request(ctx.server)
      .patch(`/knowledge/entities/${entity.id}`)
      .set(ctx.auth())
      .send({ type: 'INVALID' })
      .expect(400);

    await request(ctx.server)
      .get('/knowledge/entities/not-a-uuid')
      .set(ctx.auth())
      .expect(400);
  });

  it('returns not found for missing entities', async () => {
    await request(ctx.server)
      .get(`/knowledge/entities/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);

    await request(ctx.server)
      .patch(`/knowledge/entities/${missingUuid}`)
      .set(ctx.auth())
      .send({ canonicalName: 'Missing Entity' })
      .expect(404);

    await request(ctx.server)
      .delete(`/knowledge/entities/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('rejects entity requests without a bearer token', async () => {
    await request(ctx.server)
      .delete(`/knowledge/entities/${missingUuid}`)
      .expect(401);
  });
});
