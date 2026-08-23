import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';
import { e2eChatGenerationMock } from '../e2e-test-utils';

interface ChatActionResponse {
  kind: string;
  label: string;
  description: string;
  route: string;
}

interface ChatSourceResponse {
  kind: string;
}

interface ChatMessageResponse {
  content: string;
  sources: ChatSourceResponse[];
  actions: ChatActionResponse[];
}

interface ChatExchangeResponse {
  assistantMessage: ChatMessageResponse;
}

describe('Chat intent routing e2e', () => {
  const ctx = createEndpointTestContext();

  it('routes known application destinations with one navigation action and no work sources', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);
    const cases = [
      {
        question: '¿Dónde veo las relaciones entre los personajes?',
        route: `/projects/${project.id}/worldbuilding?tab=relationships`,
      },
      {
        question: '¿Dónde veo los personajes?',
        route: `/projects/${project.id}/worldbuilding?tab=wiki`,
      },
      {
        question: '¿Dónde veo los resúmenes de cada capítulo?',
        route: `/projects/${project.id}/worldbuilding?tab=summaries`,
      },
      {
        question: '¿Dónde está el storyboard?',
        route: `/projects/${project.id}/storyboard`,
      },
      {
        question: '¿Cómo funcionan los modos de escritura?',
        route: `/projects/${project.id}/editor`,
        answerIncludes: ['Creación', 'Revisión', 'Zen'],
      },
    ];

    for (const testCase of cases) {
      const response = await request(ctx.server)
        .post(`/chat/threads/${thread.id}/messages`)
        .set(ctx.auth())
        .send({ content: testCase.question })
        .expect(201);
      const assistant =
        responseBody<ChatExchangeResponse>(response).assistantMessage;

      expect(assistant.sources).toEqual([]);
      expect(assistant.actions).toEqual([
        expect.objectContaining({
          kind: 'navigation',
          route: testCase.route,
        }),
      ]);
      for (const expectedText of testCase.answerIncludes ?? []) {
        expect(assistant.content).toContain(expectedText);
      }
    }

    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('recognizes application help with UI context but keeps work questions out of the router', async () => {
    const { project, entity, targetEntity } = await ctx.createProjectTree();
    await ctx.createRelationship(project.id, entity.id, targetEntity.id);
    const thread = await createThread(project.id);

    const applicationResponse = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Cómo se usa la Wiki?' })
      .expect(201);
    const applicationAssistant =
      responseBody<ChatExchangeResponse>(applicationResponse).assistantMessage;
    expect(applicationAssistant.actions).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        route: `/projects/${project.id}/worldbuilding?tab=wiki`,
      }),
    ]);
    expect(applicationAssistant.sources).toEqual([]);

    const workResponse = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Qué relación tienen Entity y Target Entity?' })
      .expect(201);
    const workAssistant =
      responseBody<ChatExchangeResponse>(workResponse).assistantMessage;
    expect(workAssistant.actions).toEqual([]);
    expect(workAssistant.sources).toEqual([
      expect.objectContaining({ kind: 'wiki' }),
      expect.objectContaining({ kind: 'wiki' }),
    ]);
    expect(e2eChatGenerationMock.generate).toHaveBeenCalledTimes(1);

    const ambiguousWorkResponse = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({
        content: '¿Cómo funcionan las relaciones entre los personajes?',
      })
      .expect(201);
    const ambiguousWorkAssistant = responseBody<ChatExchangeResponse>(
      ambiguousWorkResponse,
    ).assistantMessage;
    expect(ambiguousWorkAssistant.actions).toEqual([]);
  });

  it('uses an application question as context for a short follow-up', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);

    await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Dónde veo los resúmenes?' })
      .expect(201);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Y la línea de tiempo?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(assistant.sources).toEqual([]);
    expect(assistant.actions).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        route: `/projects/${project.id}/worldbuilding?tab=timeline`,
      }),
    ]);
    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('does not route an ambiguous follow-up without application context', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Y la línea de tiempo?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(assistant.actions).toEqual([]);
    expect(assistant.sources).toEqual([]);
    expect(assistant.content).toContain('No encontre');
    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
  });

  it('returns the generic application guide for an unknown application question', async () => {
    const project = await ctx.createProject();
    const thread = await createThread(project.id);

    const response = await request(ctx.server)
      .post(`/chat/threads/${thread.id}/messages`)
      .set(ctx.auth())
      .send({ content: '¿Cómo funciona la aplicación?' })
      .expect(201);
    const assistant =
      responseBody<ChatExchangeResponse>(response).assistantMessage;

    expect(assistant.content).toContain('asistente de consulta de PlumIA');
    expect(assistant.sources).toEqual([]);
    expect(assistant.actions).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        route: `/projects/${project.id}/editor`,
      }),
    ]);
    expect(e2eChatGenerationMock.generate).not.toHaveBeenCalled();
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
