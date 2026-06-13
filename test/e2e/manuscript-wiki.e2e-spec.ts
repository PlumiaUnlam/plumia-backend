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

const tiptapDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The city wakes before dawn.' }],
    },
  ],
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

interface SceneResponse extends IdResponse {
  content: unknown;
  wordCount: number;
}

interface EntityResponse extends IdResponse {
  projectId: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  isActive: boolean;
}

interface ProjectTreeResponse extends IdResponse {
  books: Array<{
    chapters: Array<{
      scenes: IdResponse[];
    }>;
  }>;
}

describe('Manuscript and wiki e2e', () => {
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

    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD })
      .expect(201);

    const loginBody = loginResponse.body as unknown as TokenResponse;
    token = loginBody.access_token;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('creates a project tree and manages a wiki entity', async () => {
    const projectResponse = await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
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

    const bookResponse = await request(server)
      .post(`/projects/${projectId}/books`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Book One', sortKey: '001' })
      .expect(201);

    const book = bookResponse.body as unknown as IdResponse;

    const chapterResponse = await request(server)
      .post(`/books/${book.id}/chapters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Chapter One', sortKey: '001' })
      .expect(201);

    const chapter = chapterResponse.body as unknown as IdResponse;

    const sceneResponse = await request(server)
      .post(`/chapters/${chapter.id}/scenes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Opening Scene',
        sortKey: '001',
        content: tiptapDoc,
        wordCount: 7,
      })
      .expect(201);

    const scene = sceneResponse.body as unknown as SceneResponse;

    await request(server)
      .put(`/scenes/${scene.id}/content`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: tiptapDoc, wordCount: 8 })
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as SceneResponse;
        expect(body.wordCount).toBe(8);
        expect(body.content).toEqual(tiptapDoc);
      });

    const entityResponse = await request(server)
      .post(`/projects/${projectId}/entities`)
      .set('Authorization', `Bearer ${token}`)
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

    await request(server)
      .get(`/projects/${projectId}/entities?type=character&search=Nora`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as EntityResponse[];
        expect(body).toHaveLength(1);
        expect(body[0]?.id).toBe(entity.id);
      });

    await request(server)
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as ProjectTreeResponse;
        expect(body.books).toHaveLength(1);
        expect(body.books[0]?.chapters).toHaveLength(1);
        expect(body.books[0]?.chapters[0]?.scenes).toHaveLength(1);
      });
  });

  it('validates request bodies', async () => {
    await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '', unknownField: true })
      .expect(400);
  });
});
