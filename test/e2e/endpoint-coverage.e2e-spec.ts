import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createE2eApp,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  resetDatabase,
  seedJwtStrategyUser,
} from './e2e-test-utils';

const missingUuid = '00000000-0000-4000-8000-000000000000';
const tiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
};

interface TokenResponse {
  access_token: string;
}

interface IdResponse {
  id: string;
}

interface ProjectResponse extends IdResponse {
  title: string;
  status: string;
}

interface BookResponse extends IdResponse {
  projectId: string;
  title: string;
  sortKey: string;
}

interface ChapterResponse extends IdResponse {
  bookId: string;
  title: string;
  sortKey: string;
  status: string;
}

interface SceneResponse extends IdResponse {
  chapterId: string;
  title: string | null;
  sortKey: string;
  wordCount: number;
  content: unknown;
}

interface EntityResponse extends IdResponse {
  projectId: string;
  canonicalName: string;
  type: string;
  isActive: boolean;
}

describe('Endpoint coverage e2e', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createE2eApp();
    server = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedJwtStrategyUser(prisma);
    token = await login();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  async function login(): Promise<string> {
    const response = await request(server)
      .post('/auth/login')
      .send({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD })
      .expect(201);
    return (response.body as unknown as TokenResponse).access_token;
  }

  async function createProject(title = 'Project'): Promise<ProjectResponse> {
    const response = await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title, description: 'Description', genre: 'fantasy' })
      .expect(201);
    return response.body as ProjectResponse;
  }

  async function createBook(projectId: string): Promise<BookResponse> {
    const response = await request(server)
      .post(`/projects/${projectId}/books`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Book', sortKey: '001' })
      .expect(201);
    return response.body as BookResponse;
  }

  async function createChapter(bookId: string): Promise<ChapterResponse> {
    const response = await request(server)
      .post(`/books/${bookId}/chapters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Chapter', sortKey: '001' })
      .expect(201);
    return response.body as ChapterResponse;
  }

  async function createScene(
    chapterId: string,
    sortKey = '001',
  ): Promise<SceneResponse> {
    const response = await request(server)
      .post(`/chapters/${chapterId}/scenes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Scene',
        sortKey,
        content: tiptapDoc,
        wordCount: 1,
      })
      .expect(201);
    return response.body as SceneResponse;
  }

  async function createEntity(projectId: string): Promise<EntityResponse> {
    const response = await request(server)
      .post(`/projects/${projectId}/entities`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        canonicalName: 'Entity',
        type: 'character',
        description: 'Description',
      })
      .expect(201);
    return response.body as EntityResponse;
  }

  async function createProjectTree(): Promise<{
    project: ProjectResponse;
    book: BookResponse;
    chapter: ChapterResponse;
    scene: SceneResponse;
    entity: EntityResponse;
  }> {
    const project = await createProject();
    const book = await createBook(project.id);
    const chapter = await createChapter(book.id);
    const scene = await createScene(chapter.id);
    const entity = await createEntity(project.id);
    return { project, book, chapter, scene, entity };
  }

  describe('POST /auth/register', () => {
    it('creates a user and returns a token', async () => {
      const response = await request(server)
        .post('/auth/register')
        .send({
          name: 'Grace',
          lastname: 'Hopper',
          email: 'grace.e2e@example.com',
          password: 'Password123!',
        })
        .expect(201);

      expect(
        typeof (response.body as unknown as TokenResponse).access_token,
      ).toBe('string');
    });

    it('rejects invalid payloads', async () => {
      await request(server)
        .post('/auth/register')
        .send({ email: 'bad-email', password: 'short' })
        .expect(400);
    });

    it('rejects duplicated email addresses', async () => {
      await request(server)
        .post('/auth/register')
        .send({
          name: 'Grace',
          lastname: 'Hopper',
          email: E2E_USER_EMAIL,
          password: 'Password123!',
        })
        .expect(409);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token with valid credentials', async () => {
      const response = await request(server)
        .post('/auth/login')
        .send({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD })
        .expect(201);

      expect(
        typeof (response.body as unknown as TokenResponse).access_token,
      ).toBe('string');
    });

    it('rejects invalid credentials', async () => {
      await request(server)
        .post('/auth/login')
        .send({ email: E2E_USER_EMAIL, password: 'wrong-password' })
        .expect(401);
    });

    it('rejects missing credentials', async () => {
      await request(server).post('/auth/login').send({}).expect(401);
    });
  });

  describe('GET /users/me', () => {
    it('returns the authenticated user payload', async () => {
      await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ email: 'user@example.com' });
        });
    });

    it('rejects missing tokens', async () => {
      await request(server).get('/users/me').expect(401);
    });

    it('rejects invalid tokens', async () => {
      await request(server)
        .get('/users/me')
        .set('Authorization', 'Bearer invalid')
        .expect(401);
    });
  });

  describe('GET /projects', () => {
    it('lists projects for the current user', async () => {
      const project = await createProject();

      await request(server)
        .get('/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as ProjectResponse[];
          expect(body.some((item) => item.id === project.id)).toBe(true);
        });
    });

    it('returns an empty list when there are no projects', async () => {
      await request(server)
        .get('/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual([]);
        });
    });

    it('rejects missing tokens', async () => {
      await request(server).get('/projects').expect(401);
    });
  });

  describe('POST /projects', () => {
    it('creates a project', async () => {
      const project = await createProject('Created Project');
      expect(project).toMatchObject({ title: 'Created Project' });
    });

    it('rejects invalid payloads', async () => {
      await request(server)
        .post('/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '', unknown: true })
        .expect(400);
    });

    it('rejects missing tokens', async () => {
      await request(server)
        .post('/projects')
        .send({ title: 'Project' })
        .expect(401);
    });
  });

  describe('GET /projects/:id', () => {
    it('returns a project tree', async () => {
      const { project } = await createProjectTree();

      await request(server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: project.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(server)
        .get('/projects/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(server)
        .get(`/projects/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates a project', async () => {
      const project = await createProject();

      await request(server)
        .patch(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Project', status: 'active' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ title: 'Updated Project' });
        });
    });

    it('rejects invalid payloads', async () => {
      const project = await createProject();

      await request(server)
        .patch(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(server)
        .patch(`/projects/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Project' })
        .expect(404);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('soft deletes a project', async () => {
      const project = await createProject();

      await request(server)
        .delete(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 404 after the project was deleted', async () => {
      const project = await createProject();
      await request(server)
        .delete(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(server).delete(`/projects/${missingUuid}`).expect(401);
    });
  });

  describe('POST /projects/:projectId/books', () => {
    it('creates a book', async () => {
      const project = await createProject();
      const book = await createBook(project.id);
      expect(book).toMatchObject({ projectId: project.id, title: 'Book' });
    });

    it('rejects invalid payloads', async () => {
      const project = await createProject();
      await request(server)
        .post(`/projects/${project.id}/books`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '', sortKey: '' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(server)
        .post(`/projects/${missingUuid}/books`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Book', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /books/:id', () => {
    it('returns a book', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .get(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: book.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(server)
        .get('/books/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(server)
        .get(`/books/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /books/:id', () => {
    it('updates a book', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .patch(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Book' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ title: 'Updated Book' });
        });
    });

    it('rejects invalid payloads', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .patch(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '' })
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(server)
        .patch(`/books/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Book' })
        .expect(404);
    });
  });

  describe('DELETE /books/:id', () => {
    it('soft deletes a book', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .delete(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 404 after the book was deleted', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .delete(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get(`/books/${book.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(server).delete(`/books/${missingUuid}`).expect(401);
    });
  });

  describe('POST /books/:bookId/chapters', () => {
    it('creates a chapter', async () => {
      const project = await createProject();
      const book = await createBook(project.id);
      const chapter = await createChapter(book.id);
      expect(chapter).toMatchObject({ bookId: book.id, title: 'Chapter' });
    });

    it('rejects invalid payloads', async () => {
      const { book } = await createProjectTree();
      await request(server)
        .post(`/books/${book.id}/chapters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '', sortKey: '' })
        .expect(400);
    });

    it('returns 404 for missing books', async () => {
      await request(server)
        .post(`/books/${missingUuid}/chapters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Chapter', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /chapters/:id', () => {
    it('returns a chapter', async () => {
      const { chapter } = await createProjectTree();
      await request(server)
        .get(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: chapter.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(server)
        .get('/chapters/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(server)
        .get(`/chapters/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /chapters/:id', () => {
    it('updates a chapter', async () => {
      const { chapter } = await createProjectTree();
      await request(server)
        .patch(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
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
      const { chapter } = await createProjectTree();
      await request(server)
        .patch(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(server)
        .patch(`/chapters/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Chapter' })
        .expect(404);
    });
  });

  describe('DELETE /chapters/:id', () => {
    it('soft deletes a chapter', async () => {
      const { chapter } = await createProjectTree();
      await request(server)
        .delete(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 404 after the chapter was deleted', async () => {
      const { chapter } = await createProjectTree();
      await request(server)
        .delete(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get(`/chapters/${chapter.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(server).delete(`/chapters/${missingUuid}`).expect(401);
    });
  });

  describe('POST /chapters/:chapterId/scenes', () => {
    it('creates a scene', async () => {
      const { chapter } = await createProjectTree();
      const scene = await createScene(chapter.id, '002');
      expect(scene).toMatchObject({ chapterId: chapter.id, title: 'Scene' });
    });

    it('rejects invalid TipTap content', async () => {
      const { chapter } = await createProjectTree();
      await request(server)
        .post(`/chapters/${chapter.id}/scenes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sortKey: '002', content: { type: 'paragraph' } })
        .expect(400);
    });

    it('returns 404 for missing chapters', async () => {
      await request(server)
        .post(`/chapters/${missingUuid}/scenes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Scene', sortKey: '001' })
        .expect(404);
    });
  });

  describe('GET /scenes/:id', () => {
    it('returns a scene', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .get(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: scene.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(server)
        .get('/scenes/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(server)
        .get(`/scenes/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /scenes/:id', () => {
    it('updates scene metadata', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .patch(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
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
      const { scene } = await createProjectTree();
      await request(server)
        .patch(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(server)
        .patch(`/scenes/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Scene' })
        .expect(404);
    });
  });

  describe('PUT /scenes/:id/content', () => {
    it('updates scene content', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .put(`/scenes/${scene.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: tiptapDoc, wordCount: 2 })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ wordCount: 2 });
        });
    });

    it('rejects invalid TipTap documents', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .put(`/scenes/${scene.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: { type: 'paragraph' } })
        .expect(400);
    });

    it('returns 404 for missing scenes', async () => {
      await request(server)
        .put(`/scenes/${missingUuid}/content`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: tiptapDoc })
        .expect(404);
    });
  });

  describe('DELETE /scenes/:id', () => {
    it('soft deletes a scene', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .delete(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 404 after the scene was deleted', async () => {
      const { scene } = await createProjectTree();
      await request(server)
        .delete(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get(`/scenes/${scene.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(server).delete(`/scenes/${missingUuid}`).expect(401);
    });
  });

  describe('GET /projects/:projectId/entities', () => {
    it('lists entities for a project', async () => {
      const { project, entity } = await createProjectTree();
      await request(server)
        .get(`/projects/${project.id}/entities`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as EntityResponse[];
          expect(body.some((item) => item.id === entity.id)).toBe(true);
        });
    });

    it('filters entities by type and search', async () => {
      const { project, entity } = await createProjectTree();
      await request(server)
        .get(`/projects/${project.id}/entities?type=character&search=Entity`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          const body = response.body as unknown as EntityResponse[];
          expect(body[0]?.id).toBe(entity.id);
        });
    });

    it('returns 404 for missing projects', async () => {
      await request(server)
        .get(`/projects/${missingUuid}/entities`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /projects/:projectId/entities', () => {
    it('creates an entity', async () => {
      const project = await createProject();
      const entity = await createEntity(project.id);
      expect(entity).toMatchObject({
        projectId: project.id,
        canonicalName: 'Entity',
      });
    });

    it('rejects invalid entity types', async () => {
      const project = await createProject();
      await request(server)
        .post(`/projects/${project.id}/entities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canonicalName: 'Entity', type: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing projects', async () => {
      await request(server)
        .post(`/projects/${missingUuid}/entities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canonicalName: 'Entity', type: 'character' })
        .expect(404);
    });
  });

  describe('GET /entities/:id', () => {
    it('returns an entity detail', async () => {
      const { entity } = await createProjectTree();
      await request(server)
        .get(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ id: entity.id });
        });
    });

    it('rejects malformed ids', async () => {
      await request(server)
        .get('/entities/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for missing entities', async () => {
      await request(server)
        .get(`/entities/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /entities/:id', () => {
    it('updates an entity', async () => {
      const { entity } = await createProjectTree();
      await request(server)
        .patch(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canonicalName: 'Updated Entity' })
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            canonicalName: 'Updated Entity',
          });
        });
    });

    it('rejects invalid payloads', async () => {
      const { entity } = await createProjectTree();
      await request(server)
        .patch(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'invalid' })
        .expect(400);
    });

    it('returns 404 for missing entities', async () => {
      await request(server)
        .patch(`/entities/${missingUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canonicalName: 'Updated Entity' })
        .expect(404);
    });
  });

  describe('DELETE /entities/:id', () => {
    it('soft deletes an entity', async () => {
      const { entity } = await createProjectTree();
      await request(server)
        .delete(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 404 after the entity was deleted', async () => {
      const { entity } = await createProjectTree();
      await request(server)
        .delete(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get(`/entities/${entity.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects missing tokens', async () => {
      await request(server).delete(`/entities/${missingUuid}`).expect(401);
    });
  });
});
