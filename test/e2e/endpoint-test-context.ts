import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createE2eApp,
  E2E_TOKEN,
  resetDatabase,
  seedE2eUser,
} from './e2e-test-utils';

export const missingUuid = '00000000-0000-4000-8000-000000000000';
export const tiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
};

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
  aliases: string[];
  description: string | null;
  attributes: unknown;
  imageUrl: string | null;
  isActive: boolean;
}

export interface RelationshipResponse extends IdResponse {
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
}

export interface TimelineEventResponse extends IdResponse {
  projectId: string;
  title: string;
  date: string | null;
  temporalLabel: string | null;
  impact: string;
  storyboardArcId: string | null;
  entityIds: string[];
  position: string;
  source: string;
}

export interface StoryboardCardResponse extends IdResponse {
  projectId: string;
  chapterId: string | null;
  title: string;
  status: string;
  tags: string[];
  characters: string[];
  entityIds: string[];
}

export interface StoryboardMatrixNoteResponse extends IdResponse {
  arcId: string;
  chapterId: string;
  content: string;
}

export interface StoryboardArcResponse extends IdResponse {
  projectId: string;
  title: string;
  sourceType: string;
  customType: string | null;
  entityId: string | null;
  relationshipId: string | null;
  notes: StoryboardMatrixNoteResponse[];
}

interface ProjectTree {
  project: ProjectResponse;
  book: BookResponse;
  chapter: ChapterResponse;
  scene: SceneResponse;
  entity: EntityResponse;
  targetEntity: EntityResponse;
}

export interface EndpointTestContext {
  app: INestApplication;
  server: App;
  prisma: PrismaClient;
  auth: () => { Authorization: string };
  createProject: (title?: string) => Promise<ProjectResponse>;
  createBook: (projectId: string) => Promise<BookResponse>;
  createChapter: (bookId: string, sortKey?: string) => Promise<ChapterResponse>;
  createScene: (chapterId: string, sortKey?: string) => Promise<SceneResponse>;
  createEntity: (
    projectId: string,
    canonicalName?: string,
  ) => Promise<EntityResponse>;
  createRelationship: (
    projectId: string,
    sourceEntityId: string,
    targetEntityId: string,
  ) => Promise<RelationshipResponse>;
  createProjectTree: () => Promise<ProjectTree>;
}

export function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

export function createEndpointTestContext(): EndpointTestContext {
  let app: INestApplication | undefined;
  let server: App;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createE2eApp();
    server = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedE2eUser(prisma);
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${E2E_TOKEN}` };
  }

  async function createProject(title = 'Project'): Promise<ProjectResponse> {
    const response = await request(server)
      .post('/projects')
      .set(auth())
      .send({ title, description: 'Description', genre: 'fantasy' })
      .expect(201);
    return response.body as ProjectResponse;
  }

  async function createBook(projectId: string): Promise<BookResponse> {
    const response = await request(server)
      .post(`/projects/${projectId}/books`)
      .set(auth())
      .send({ title: 'Book', sortKey: '001' })
      .expect(201);
    return response.body as BookResponse;
  }

  async function createChapter(
    bookId: string,
    sortKey = '001',
  ): Promise<ChapterResponse> {
    const response = await request(server)
      .post(`/books/${bookId}/chapters`)
      .set(auth())
      .send({ title: 'Chapter', sortKey })
      .expect(201);
    return response.body as ChapterResponse;
  }

  async function createScene(
    chapterId: string,
    sortKey = '001',
  ): Promise<SceneResponse> {
    const response = await request(server)
      .post(`/chapters/${chapterId}/scenes`)
      .set(auth())
      .send({ title: 'Scene', sortKey, content: tiptapDoc, wordCount: 1 })
      .expect(201);
    return response.body as SceneResponse;
  }

  async function createEntity(
    projectId: string,
    canonicalName = 'Entity',
  ): Promise<EntityResponse> {
    const response = await request(server)
      .post(`/knowledge/entities?projectId=${projectId}`)
      .set(auth())
      .send({
        canonicalName,
        type: 'CHARACTER',
        description: 'Description',
      })
      .expect(201);
    return response.body as EntityResponse;
  }

  async function createRelationship(
    projectId: string,
    sourceEntityId: string,
    targetEntityId: string,
  ): Promise<RelationshipResponse> {
    const response = await request(server)
      .post(`/knowledge/relationships?projectId=${projectId}`)
      .set(auth())
      .send({
        sourceEntityId,
        targetEntityId,
        relationType: 'KNOWS',
        intensity: 3,
        description: 'Knows each other',
      })
      .expect(201);
    return response.body as RelationshipResponse;
  }

  async function createProjectTree(): Promise<ProjectTree> {
    const project = await createProject();
    const book = await createBook(project.id);
    const chapter = await createChapter(book.id);
    const scene = await createScene(chapter.id);
    const entity = await createEntity(project.id);
    const targetEntity = await createEntity(project.id, 'Target Entity');
    return { project, book, chapter, scene, entity, targetEntity };
  }

  return {
    get app() {
      return app!;
    },
    get server() {
      return server;
    },
    get prisma() {
      return prisma;
    },
    auth,
    createProject,
    createBook,
    createChapter,
    createScene,
    createEntity,
    createRelationship,
    createProjectTree,
  };
}
