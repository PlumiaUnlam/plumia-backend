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

export const missingUuid = '00000000-0000-4000-8000-000000000000';
export const tiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
};

export interface TokenResponse {
  access_token: string;
}

export interface IdResponse {
  id: string;
}

export interface ProjectResponse extends IdResponse {
  title: string;
  status: string;
}

export interface BookResponse extends IdResponse {
  projectId: string;
  title: string;
  sortKey: string;
}

export interface ChapterResponse extends IdResponse {
  bookId: string;
  title: string;
  sortKey: string;
  status: string;
}

export interface SceneResponse extends IdResponse {
  chapterId: string;
  title: string | null;
  sortKey: string;
  wordCount: number;
  content: unknown;
}

export interface EntityResponse extends IdResponse {
  projectId: string;
  canonicalName: string;
  type: string;
  isActive: boolean;
}

interface ProjectTree {
  project: ProjectResponse;
  book: BookResponse;
  chapter: ChapterResponse;
  scene: SceneResponse;
  entity: EntityResponse;
}

export interface EndpointTestContext {
  server: App;
  getToken: () => string;
  login: () => Promise<string>;
  createProject: (title?: string) => Promise<ProjectResponse>;
  createBook: (projectId: string) => Promise<BookResponse>;
  createChapter: (bookId: string) => Promise<ChapterResponse>;
  createScene: (chapterId: string, sortKey?: string) => Promise<SceneResponse>;
  createEntity: (projectId: string) => Promise<EntityResponse>;
  createProjectTree: () => Promise<ProjectTree>;
}

export function createEndpointTestContext(): EndpointTestContext {
  let app: INestApplication | undefined;
  let server: App;
  let prisma: PrismaClient;
  let token = '';

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
      .send({ title: 'Scene', sortKey, content: tiptapDoc, wordCount: 1 })
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

  async function createProjectTree(): Promise<ProjectTree> {
    const project = await createProject();
    const book = await createBook(project.id);
    const chapter = await createChapter(book.id);
    const scene = await createScene(chapter.id);
    const entity = await createEntity(project.id);
    return { project, book, chapter, scene, entity };
  }

  return {
    get server() {
      return server;
    },
    getToken: () => token,
    login,
    createProject,
    createBook,
    createChapter,
    createScene,
    createEntity,
    createProjectTree,
  };
}
