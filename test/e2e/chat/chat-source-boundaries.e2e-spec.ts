import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';
import { e2eChatGenerationMock } from '../e2e-test-utils';

interface ChatSourceResponse {
  kind: string;
  textQuote?: string;
}

interface ChatMessageResponse {
  content: string;
  sources: ChatSourceResponse[];
  actions: unknown[];
}

interface ChatExchangeResponse {
  assistantMessage: ChatMessageResponse;
}

describe('Chat source boundaries e2e', () => {
  const ctx = createEndpointTestContext();

  it('uses only manuscript, Wiki, and timeline as work sources', async () => {
    const { project, scene, entity } = await ctx.createProjectTree();
    await ctx.prisma.chunk.updateMany({
      where: { sceneId: scene.id },
      data: {
        content: 'Entity guarda el mapa durante el eclipse.',
        contentHash: 'official-sources-hash',
      },
    });
    await ctx.prisma.entity.update({
      where: { id: entity.id },
      data: { description: 'Entity guarda el mapa durante el eclipse.' },
    });
    await ctx.prisma.timelineEvent.create({
      data: {
        projectId: project.id,
        title: 'Entity guarda el mapa',
        description: 'El mapa queda a salvo durante el eclipse.',
        temporalLabel: 'Día del eclipse',
        position: new Prisma.Decimal(1),
      },
    });
    await ctx.prisma.summary.create({
      data: {
        projectId: project.id,
        scopeType: 'scene',
        scopeId: scene.id,
        title: 'Resumen del eclipse',
        content: 'Entity guarda el mapa durante el eclipse.',
      },
    });
    await ctx.prisma.storyboardNote.create({
      data: {
        projectId: project.id,
        title: 'Idea del eclipse',
        content: 'Entity guarda el mapa durante el eclipse.',
        sortKey: '001',
      },
    });
    const thread = await createThread(project.id);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Qué hizo Entity durante el eclipse?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(new Set(assistant.sources.map((source) => source.kind))).toEqual(
      new Set(['manuscript', 'wiki', 'timeline']),
    );
    expect(assistant.sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'summary' }),
        expect.objectContaining({ kind: 'storyboard' }),
      ]),
    );
    expect(assistant.actions).toEqual([]);
    expect(e2eChatGenerationMock.generate).toHaveBeenCalledTimes(1);
  });

  it('does not answer from a summary when the official sources are empty', async () => {
    const { project, scene } = await ctx.createProjectTree();
    await ctx.prisma.summary.create({
      data: {
        projectId: project.id,
        scopeType: 'scene',
        scopeId: scene.id,
        title: 'Resumen secreto',
        content: 'El unicornio violeta vive en la torre de cuarzo.',
      },
    });
    const thread = await createThread(project.id);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Qué dice el resumen sobre el unicornio violeta?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(assistant.content).toContain('No encontre');
    expect(assistant.sources).toEqual([]);
    expect(assistant.actions).toEqual([]);
    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('keeps the open editor chapter out of retrieval scope', async () => {
    const { project, book } = await ctx.createProjectTree();
    const futureChapter = await ctx.createChapter(book.id, '002');
    const futureScene = await ctx.createScene(futureChapter.id, '001');
    await ctx.prisma.chunk.updateMany({
      where: { sceneId: futureScene.id },
      data: {
        content: 'El secreto solo aparece en el capítulo futuro.',
        contentHash: 'future-chapter-hash',
      },
    });
    const thread = await createThread(project.id);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Qué revela el secreto del capítulo futuro?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(assistant.sources).toEqual([
      expect.objectContaining({
        kind: 'manuscript',
        chapterId: futureChapter.id,
      }),
    ]);
    expect(assistant.sources[0]?.textQuote).toContain(
      'El secreto solo aparece',
    );
  });

  async function createThread(projectId: string): Promise<{ id: string }> {
    const response = await request(ctx.server)
      .post(`/projects/${projectId}/chat/threads`)
      .set(ctx.auth())
      .send({})
      .expect(201);
    return responseBody<{ id: string }>(response);
  }
});
