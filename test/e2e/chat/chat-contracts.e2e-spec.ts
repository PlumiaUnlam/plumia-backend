import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';
import { e2eChatGenerationMock } from '../e2e-test-utils';

interface ChatThreadResponse {
  id: string;
  title: string;
  isArchived: boolean;
}

interface ChatThreadPageResponse {
  items: ChatThreadResponse[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

describe('Chat conversation contracts e2e', () => {
  const ctx = createEndpointTestContext();

  it('rejects messages sent to an archived conversation', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);

    await request(ctx.server)
      .patch(`/chat/threads/${thread.id}`)
      .set(ctx.auth())
      .send({ isArchived: true })
      .expect(200);

    await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Qué pasó en la obra?' })
      .expect(400);

    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('trims custom titles and searches conversations by message content', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id, '  Investigación  ');

    await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: 'Hola, ¿cómo andás?' })
      .expect(201);

    await request(ctx.server)
      .get(`/projects/${project.id}/chat/threads?search=andás`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const page = responseBody<ChatThreadPageResponse>(response);
        expect(page.items).toEqual([
          expect.objectContaining({
            id: thread.id,
            title: 'Investigación',
          }),
        ]);
        expect(page.total).toBe(1);
      });
  });

  it('caps persisted context to the latest ten messages', async () => {
    const { project, scene } = await ctx.createProjectTree();
    await ctx.prisma.chunk.updateMany({
      where: { sceneId: scene.id },
      data: {
        content: 'Maren encuentra una llave en el archivo.',
        contentHash: 'history-limit-hash',
      },
    });
    const thread = await createThread(project.id);

    for (let index = 0; index < 6; index += 1) {
      await request(ctx.server)
        .post(`/chat/threads/${thread.id}/messages`)
        .set(ctx.auth())
        .send({ content: '¿Qué encontró Maren en el archivo?' })
        .expect(201);
    }

    const lastInput = e2eChatGenerationMock.generate.mock.calls.at(-1)?.[0];
    expect(lastInput?.history).toHaveLength(10);
    expect(lastInput?.history[0]).toEqual(
      expect.objectContaining({ role: 'user' }),
    );
    expect(e2eChatGenerationMock.generate).toHaveBeenCalledTimes(6);
  });

  it('rejects invalid chat payloads and unknown fields', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);

    await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: 'Pregunta válida', unexpected: true })
      .expect(400);
    await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({})
      .expect(400);
    await request(ctx.server)
      .patch(`/chat/threads/${thread.id}`)
      .set(ctx.auth())
      .send({ title: '   ' })
      .expect(400);

    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('honors the history page size and hasMore contract', async () => {
    const project = await ctx.createProject();
    await createThread(project.id, 'Primera');
    await createThread(project.id, 'Segunda');
    await createThread(project.id, 'Tercera');

    await request(ctx.server)
      .get(`/projects/${project.id}/chat/threads?page=1&pageSize=2`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const page = responseBody<ChatThreadPageResponse>(response);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(2);
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(3);
        expect(page.hasMore).toBe(true);
      });

    await request(ctx.server)
      .get(`/projects/${project.id}/chat/threads?page=2&pageSize=2`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const page = responseBody<ChatThreadPageResponse>(response);
        expect(page.items).toHaveLength(1);
        expect(page.hasMore).toBe(false);
      });
  });

  async function createThread(
    projectId: string,
    title?: string,
  ): Promise<ChatThreadResponse> {
    const response = await request(ctx.server)
      .post(`/projects/${projectId}/chat/threads`)
      .set(ctx.auth())
      .send(title === undefined ? {} : { title })
      .expect(201);
    return responseBody<ChatThreadResponse>(response);
  }
});
