import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  type EntityResponse,
} from './endpoint-test-context';

describe('Wiki entity endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  describe('GET /projects/:projectId/entities', () => {
    it('lists entities for a project', async () => {
      const { project, entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/projects/${project.id}/entities`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as EntityResponse[];
          expect(body.some((item) => item.id === entity.id)).toBe(true);
        });
    });

    it('filters entities by type and search', async () => {
      const { project, entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/projects/${project.id}/entities?type=character&search=Entity`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as EntityResponse[];
          expect(body[0]?.id).toBe(entity.id);
        });
    });

    it('returns 404 for missing projects', async () => {
      await request(ctx.server)
        .get(`/projects/${missingUuid}/entities`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('POST /projects/:projectId/entities', () => {
    it('creates an entity', async () => {
      const project = await ctx.createProject();
      const entity = await ctx.createEntity(project.id);
      expect(entity).toMatchObject({
        projectId: project.id,
        canonicalName: 'Entity',
      });
    });

    it('rejects invalid entity types', async () => {
      const project = await ctx.createProject();
      await request(ctx.server)
        .post(`/projects/${project.id}/entities`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ canonicalName: 'Entity', type: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(ctx.server)
        .post(`/projects/${missingUuid}/entities`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ canonicalName: 'Entity', type: 'character' })
        .expect(404);
    });
  });

  describe('GET /entities/:id', () => {
    it('returns an entity detail', async () => {
      const { entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: entity.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(ctx.server)
        .get('/entities/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(400);
    });

    it('returns 404 for missing entities', async () => {
      await request(ctx.server)
        .get(`/entities/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /entities/:id', () => {
    it('updates an entity', async () => {
      const { entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ canonicalName: 'Updated Entity' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            canonicalName: 'Updated Entity',
          });
        });
    });

    it('rejects invalid payloads', async () => {
      const { entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ type: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing entities', async () => {
      await request(ctx.server)
        .patch(`/entities/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ canonicalName: 'Updated Entity' })
        .expect(404);
    });
  });

  describe('DELETE /entities/:id', () => {
    it('soft deletes an entity', async () => {
      const { entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);
    });

    it('returns 404 after the entity was deleted', async () => {
      const { entity } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);

      await request(ctx.server)
        .get(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).delete(`/entities/${missingUuid}`).expect(401);
    });
  });
});
