import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  type ProjectResponse,
} from './endpoint-test-context';

describe('Project endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  describe('GET /projects', () => {
    it('lists projects for the current user', async () => {
      const project = await ctx.createProject();

      await request(ctx.server)
        .get('/projects')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as ProjectResponse[];
          expect(body.some((item) => item.id === project.id)).toBe(true);
        });
    });

    it('returns an empty list when there are no projects', async () => {
      await request(ctx.server)
        .get('/projects')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual([]);
        });
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).get('/projects').expect(401);
    });
  });

  describe('POST /projects', () => {
    it('creates a project', async () => {
      const project = await ctx.createProject('Created Project');
      expect(project).toMatchObject({ title: 'Created Project' });
    });

    it('rejects invalid payloads', async () => {
      await request(ctx.server)
        .post('/projects')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: '', unknown: true })
        .expect(400);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server)
        .post('/projects')
        .send({ title: 'Project' })
        .expect(401);
    });
  });

  describe('GET /projects/:id', () => {
    it('returns a project tree', async () => {
      const { project } = await ctx.createProjectTree();

      await request(ctx.server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: project.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(ctx.server)
        .get('/projects/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(ctx.server)
        .get(`/projects/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates a project', async () => {
      const project = await ctx.createProject();

      await request(ctx.server)
        .patch(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Project', status: 'active' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ title: 'Updated Project' });
        });
    });

    it('rejects invalid payloads', async () => {
      const project = await ctx.createProject();

      await request(ctx.server)
        .patch(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(ctx.server)
        .patch(`/projects/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Project' })
        .expect(404);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('soft deletes a project', async () => {
      const project = await ctx.createProject();

      await request(ctx.server)
        .delete(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);
    });

    it('returns 404 after the project was deleted', async () => {
      const project = await ctx.createProject();
      await request(ctx.server)
        .delete(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);

      await request(ctx.server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).delete(`/projects/${missingUuid}`).expect(401);
    });
  });
});
