import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
  type ProjectResponse,
} from '../endpoint-test-context';

interface ProjectTreeResponse extends ProjectResponse {
  books: Array<{
    id: string;
    chapters: Array<{
      id: string;
      scenes: Array<{ id: string }>;
    }>;
  }>;
}

describe('Project endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('lists projects for the current user', async () => {
    const project = await ctx.createProject();

    await request(ctx.server)
      .get('/projects')
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ProjectResponse[]>(response);
        expect(body.some((item) => item.id === project.id)).toBe(true);
      });
  });

  it('returns an empty list when there are no projects', async () => {
    await request(ctx.server)
      .get('/projects')
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<ProjectResponse[]>(response)).toEqual([]);
      });
  });

  it('creates a project', async () => {
    const project = await ctx.createProject('Created Project');
    expect(project).toMatchObject({ title: 'Created Project' });
  });

  it('rejects invalid project payloads and missing tokens', async () => {
    await request(ctx.server)
      .post('/projects')
      .set(ctx.auth())
      .send({ title: '', unknownField: true })
      .expect(400);

    await request(ctx.server)
      .post('/projects')
      .send({ title: 'Project' })
      .expect(401);
  });

  it('returns a complete project tree', async () => {
    const { project, book, chapter, scene } = await ctx.createProjectTree();

    await request(ctx.server)
      .get(`/projects/${project.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ProjectTreeResponse>(response);
        expect(body).toMatchObject({ id: project.id });
        const firstBook = body.books[0];
        if (!firstBook) {
          throw new Error('Expected the project tree to contain a book');
        }
        expect(firstBook).toMatchObject({ id: book.id });
        const firstChapter = firstBook.chapters[0];
        if (!firstChapter) {
          throw new Error('Expected the book to contain a chapter');
        }
        expect(firstChapter).toMatchObject({ id: chapter.id });
        const firstScene = firstChapter.scenes[0];
        if (!firstScene) {
          throw new Error('Expected the chapter to contain a scene');
        }
        expect(firstScene).toMatchObject({ id: scene.id });
      });
  });

  it('validates project ids and missing projects', async () => {
    await request(ctx.server)
      .get('/projects/not-a-uuid')
      .set(ctx.auth())
      .expect(400);

    await request(ctx.server)
      .get(`/projects/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('updates and soft deletes a project', async () => {
    const project = await ctx.createProject('Project to update');

    await request(ctx.server)
      .patch(`/projects/${project.id}`)
      .set(ctx.auth())
      .send({ title: 'Updated Project', status: 'active' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<ProjectResponse>(response);
        expect(body).toMatchObject({ title: 'Updated Project' });
      });

    await request(ctx.server)
      .delete(`/projects/${project.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .get(`/projects/${project.id}`)
      .set(ctx.auth())
      .expect(404);
  });
});
