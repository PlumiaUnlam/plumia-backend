import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
  type BookResponse,
  type ChapterResponse,
  type SceneResponse,
} from '../endpoint-test-context';

const twoWordDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Two words' }] },
  ],
};

describe('Book, chapter and scene endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates, reads, updates and deletes books', async () => {
    const project = await ctx.createProject();
    const book = await ctx.createBook(project.id);
    expect(book).toMatchObject({ projectId: project.id, title: 'Book' });

    await request(ctx.server)
      .get(`/books/${book.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<BookResponse>(response);
        expect(body).toMatchObject({ id: book.id });
      });

    await request(ctx.server)
      .patch(`/books/${book.id}`)
      .set(ctx.auth())
      .send({ title: 'Updated Book' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<BookResponse>(response);
        expect(body).toMatchObject({ title: 'Updated Book' });
      });

    await request(ctx.server)
      .delete(`/books/${book.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .get(`/books/${book.id}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('validates book payloads, ids and parents', async () => {
    const project = await ctx.createProject();

    await request(ctx.server)
      .post(`/projects/${project.id}/books`)
      .set(ctx.auth())
      .send({ title: '', sortKey: '' })
      .expect(400);

    await request(ctx.server)
      .post(`/projects/${missingUuid}/books`)
      .set(ctx.auth())
      .send({ title: 'Book', sortKey: '001' })
      .expect(404);

    await request(ctx.server)
      .get('/books/not-a-uuid')
      .set(ctx.auth())
      .expect(400);

    await request(ctx.server)
      .get(`/books/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);

    await request(ctx.server).delete(`/books/${missingUuid}`).expect(401);
  });

  it('creates, reads, updates and deletes chapters', async () => {
    const { book } = await ctx.createProjectTree();
    const chapter = await ctx.createChapter(book.id, '002');
    expect(chapter).toMatchObject({ bookId: book.id, title: 'Chapter' });

    await request(ctx.server)
      .get(`/chapters/${chapter.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ChapterResponse>(response);
        expect(body).toMatchObject({ id: chapter.id });
      });

    await request(ctx.server)
      .patch(`/chapters/${chapter.id}`)
      .set(ctx.auth())
      .send({ title: 'Updated Chapter', status: 'DONE' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<ChapterResponse>(response);
        expect(body).toMatchObject({
          title: 'Updated Chapter',
          status: 'DONE',
        });
      });

    await request(ctx.server)
      .delete(`/chapters/${chapter.id}`)
      .set(ctx.auth())
      .expect(200);

    await request(ctx.server)
      .get(`/chapters/${chapter.id}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('validates chapter payloads, ids and parents', async () => {
    const { book } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/books/${book.id}/chapters`)
      .set(ctx.auth())
      .send({ title: '', sortKey: '' })
      .expect(400);

    await request(ctx.server)
      .post(`/books/${missingUuid}/chapters`)
      .set(ctx.auth())
      .send({ title: 'Chapter', sortKey: '001' })
      .expect(404);

    await request(ctx.server)
      .get('/chapters/not-a-uuid')
      .set(ctx.auth())
      .expect(400);

    await request(ctx.server)
      .get(`/chapters/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);

    await request(ctx.server).delete(`/chapters/${missingUuid}`).expect(401);
  });

  it('creates, reads, updates and deletes scenes', async () => {
    const { chapter } = await ctx.createProjectTree();
    const scene = await ctx.createScene(chapter.id, '002');
    expect(scene).toMatchObject({ chapterId: chapter.id, title: 'Scene' });

    await request(ctx.server)
      .get(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<SceneResponse>(response);
        expect(body).toMatchObject({ id: scene.id });
      });

    await request(ctx.server)
      .patch(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .send({ title: 'Updated Scene', status: 'REVIEW' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<SceneResponse>(response);
        expect(body).toMatchObject({
          title: 'Updated Scene',
          status: 'REVIEW',
        });
      });

    await request(ctx.server)
      .patch(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .send({ content: twoWordDoc, wordCount: 2 })
      .expect(200)
      .expect((response) => {
        const body = responseBody<SceneResponse>(response);
        expect(body).toMatchObject({ wordCount: 2 });
      });

    await request(ctx.server)
      .delete(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .expect(204);

    await request(ctx.server)
      .get(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .expect(404);
  });

  it('validates scene payloads, ids and parents', async () => {
    const { chapter, scene } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/chapters/${chapter.id}/scenes`)
      .set(ctx.auth())
      .send({ sortKey: '002', content: { type: 'paragraph' } })
      .expect(400);

    await request(ctx.server)
      .post(`/chapters/${missingUuid}/scenes`)
      .set(ctx.auth())
      .send({ title: 'Scene', sortKey: '001' })
      .expect(404);

    await request(ctx.server)
      .patch(`/scenes/${scene.id}`)
      .set(ctx.auth())
      .send({ status: 'invalid' })
      .expect(400);

    await request(ctx.server)
      .get('/scenes/not-a-uuid')
      .set(ctx.auth())
      .expect(400);

    await request(ctx.server)
      .get(`/scenes/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);

    await request(ctx.server).delete(`/scenes/${missingUuid}`).expect(401);
  });
});
