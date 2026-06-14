import request from 'supertest';
import {
  createEndpointTestContext,
  tiptapDoc,
  type EntityResponse,
  type IdResponse,
  type ProjectResponse,
  type SceneResponse,
} from './endpoint-test-context';

interface ProjectTreeResponse extends IdResponse {
  books: Array<{
    chapters: Array<{
      scenes: IdResponse[];
    }>;
  }>;
}

describe('Manuscript and wiki e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates a project tree and manages a wiki entity', async () => {
    const projectResponse = await request(ctx.server)
      .post('/projects')
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({
        title: 'E2E Novel',
        description: 'A test manuscript',
        genre: 'science fiction',
        wordCountTarget: 80000,
      })
      .expect(201);

    const project = projectResponse.body as unknown as ProjectResponse;
    const projectId = project.id;
    expect(project).toMatchObject({
      title: 'E2E Novel',
      status: 'draft',
    });

    const bookResponse = await request(ctx.server)
      .post(`/projects/${projectId}/books`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({ title: 'Book One', sortKey: '001' })
      .expect(201);

    const book = bookResponse.body as unknown as IdResponse;

    const chapterResponse = await request(ctx.server)
      .post(`/books/${book.id}/chapters`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({ title: 'Chapter One', sortKey: '001' })
      .expect(201);

    const chapter = chapterResponse.body as unknown as IdResponse;

    const sceneResponse = await request(ctx.server)
      .post(`/chapters/${chapter.id}/scenes`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({
        title: 'Opening Scene',
        sortKey: '001',
        content: tiptapDoc,
        wordCount: 7,
      })
      .expect(201);

    const scene = sceneResponse.body as unknown as SceneResponse;

    await request(ctx.server)
      .put(`/scenes/${scene.id}/content`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({ content: tiptapDoc, wordCount: 8 })
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as SceneResponse;
        expect(body.wordCount).toBe(8);
        expect(body.content).toEqual(tiptapDoc);
      });

    const entityResponse = await request(ctx.server)
      .post(`/projects/${projectId}/entities`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({
        canonicalName: 'Nora Vale',
        type: 'character',
        aliases: ['Nora'],
        description: 'Main test character',
        attributes: { role: 'protagonist' },
      })
      .expect(201);

    const entity = entityResponse.body as unknown as EntityResponse;

    expect(entity).toMatchObject({
      projectId,
      canonicalName: 'Nora Vale',
      type: 'character',
      aliases: ['Nora'],
      isActive: true,
    });

    await request(ctx.server)
      .get(`/projects/${projectId}/entities?type=character&search=Nora`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as EntityResponse[];
        expect(body).toHaveLength(1);
        expect(body[0]?.id).toBe(entity.id);
      });

    await request(ctx.server)
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as ProjectTreeResponse;
        expect(body.books).toHaveLength(1);
        expect(body.books[0]?.chapters).toHaveLength(1);
        expect(body.books[0]?.chapters[0]?.scenes).toHaveLength(1);
      });
  });

  it('validates request bodies', async () => {
    await request(ctx.server)
      .post('/projects')
      .set('Authorization', `Bearer ${ctx.getToken()}`)
      .send({ title: '', unknownField: true })
      .expect(400);
  });
});
