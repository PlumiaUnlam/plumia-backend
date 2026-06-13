import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  tiptapDoc,
} from './endpoint-test-context';

describe('Manuscript endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  describe('POST /projects/:projectId/books', () => {
    it('creates a book', async () => {
      const project = await ctx.createProject();
      const book = await ctx.createBook(project.id);
      expect(book).toMatchObject({ projectId: project.id, title: 'Book' });
    });

    it('rejects invalid payloads', async () => {
      const project = await ctx.createProject();
      await request(ctx.server)
        .post(`/projects/${project.id}/books`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: '', sortKey: '' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(ctx.server)
        .post(`/projects/${missingUuid}/books`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Book', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /books/:id', () => {
    it('returns a book', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: book.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(ctx.server)
        .get('/books/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(ctx.server)
        .get(`/books/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /books/:id', () => {
    it('updates a book', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Book' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ title: 'Updated Book' });
        });
    });

    it('rejects invalid payloads', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: '' })
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(ctx.server)
        .patch(`/books/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Book' })
        .expect(404);
    });
  });

  describe('DELETE /books/:id', () => {
    it('soft deletes a book', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);
    });

    it('returns 404 after the book was deleted', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);

      await request(ctx.server)
        .get(`/books/${book.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).delete(`/books/${missingUuid}`).expect(401);
    });
  });

  describe('POST /books/:bookId/chapters', () => {
    it('creates a chapter', async () => {
      const project = await ctx.createProject();
      const book = await ctx.createBook(project.id);
      const chapter = await ctx.createChapter(book.id);
      expect(chapter).toMatchObject({ bookId: book.id, title: 'Chapter' });
    });

    it('rejects invalid payloads', async () => {
      const { book } = await ctx.createProjectTree();
      await request(ctx.server)
        .post(`/books/${book.id}/chapters`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: '', sortKey: '' })
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(ctx.server)
        .post(`/books/${missingUuid}/chapters`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Chapter', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /chapters/:id', () => {
    it('returns a chapter', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: chapter.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(ctx.server)
        .get('/chapters/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(ctx.server)
        .get(`/chapters/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /chapters/:id', () => {
    it('updates a chapter', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Chapter', status: 'DONE' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            title: 'Updated Chapter',
            status: 'DONE',
          });
        });
    });

    it('rejects invalid payloads', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(ctx.server)
        .patch(`/chapters/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Chapter' })
        .expect(404);
    });
  });

  describe('DELETE /chapters/:id', () => {
    it('soft deletes a chapter', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);
    });

    it('returns 404 after the chapter was deleted', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);

      await request(ctx.server)
        .get(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).delete(`/chapters/${missingUuid}`).expect(401);
    });
  });

  describe('POST /chapters/:chapterId/scenes', () => {
    it('creates a scene', async () => {
      const { chapter } = await ctx.createProjectTree();
      const scene = await ctx.createScene(chapter.id, '002');
      expect(scene).toMatchObject({ chapterId: chapter.id, title: 'Scene' });
    });

    it('rejects invalid TipTap content', async () => {
      const { chapter } = await ctx.createProjectTree();
      await request(ctx.server)
        .post(`/chapters/${chapter.id}/scenes`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ sortKey: '002', content: { type: 'paragraph' } })
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(ctx.server)
        .post(`/chapters/${missingUuid}/scenes`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Scene', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /scenes/:id', () => {
    it('returns a scene', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .get(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: scene.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(ctx.server)
        .get('/scenes/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(ctx.server)
        .get(`/scenes/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });
  });

  describe('PATCH /scenes/:id', () => {
    it('updates scene metadata', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Scene', status: 'REVIEW' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            title: 'Updated Scene',
            status: 'REVIEW',
          });
        });
    });

    it('rejects invalid metadata', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .patch(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(ctx.server)
        .patch(`/scenes/${missingUuid}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ title: 'Updated Scene' })
        .expect(404);
    });
  });

  describe('PUT /scenes/:id/content', () => {
    it('updates scene content', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .put(`/scenes/${scene.id}/content`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ content: tiptapDoc, wordCount: 2 })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ wordCount: 2 });
        });
    });

    it('rejects invalid TipTap documents', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .put(`/scenes/${scene.id}/content`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ content: { type: 'paragraph' } })
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(ctx.server)
        .put(`/scenes/${missingUuid}/content`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .send({ content: tiptapDoc })
        .expect(404);
    });
  });

  describe('DELETE /scenes/:id', () => {
    it('soft deletes a scene', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);
    });

    it('returns 404 after the scene was deleted', async () => {
      const { scene } = await ctx.createProjectTree();
      await request(ctx.server)
        .delete(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200);

      await request(ctx.server)
        .get(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).delete(`/scenes/${missingUuid}`).expect(401);
    });
  });
});
