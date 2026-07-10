import request from 'supertest';
import {
  createEndpointTestContext,
  missingUuid,
  responseBody,
} from '../endpoint-test-context';

interface SummaryResponse {
  id: string;
  content: string;
  source: string;
}

interface SummaryJobResponse {
  id: string;
  status: string;
}

describe('Summary endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('reads and manually updates scene summaries', async () => {
    const { project, scene } = await ctx.createProjectTree();
    const summary = await ctx.prisma.summary.create({
      data: {
        projectId: project.id,
        scopeType: 'scene',
        scopeId: scene.id,
        title: 'Scene',
        content: 'Initial summary',
        source: 'ai_generated',
      },
    });

    await request(ctx.server)
      .get(`/scenes/${scene.id}/summary`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<SummaryResponse>(response);
        expect(body).toMatchObject({ content: 'Initial summary' });
      });

    await request(ctx.server)
      .patch(`/summaries/${summary.id}`)
      .set(ctx.auth())
      .send({ content: 'Manual summary' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<SummaryResponse>(response);
        expect(body).toMatchObject({
          content: 'Manual summary',
          source: 'author_manual',
        });
      });
  });

  it('queues summary generation and exposes job state', async () => {
    const { scene } = await ctx.createProjectTree();

    const response = await request(ctx.server)
      .post(`/scenes/${scene.id}/summary/generate`)
      .set(ctx.auth())
      .expect(202);

    const jobId = responseBody<SummaryJobResponse>(response).id;
    expect(jobId).toEqual(expect.any(String));

    await request(ctx.server)
      .get(`/summary-jobs/${jobId}`)
      .set(ctx.auth())
      .expect(200)
      .expect((jobResponse) => {
        const body = responseBody<SummaryJobResponse>(jobResponse);
        expect(body).toMatchObject({
          id: jobId,
          status: 'QUEUED',
        });
      });
  });

  it('returns not found for missing summaries and jobs', async () => {
    await request(ctx.server)
      .get(`/scenes/${missingUuid}/summary`)
      .set(ctx.auth())
      .expect(404);

    await request(ctx.server)
      .get(`/summary-jobs/${missingUuid}`)
      .set(ctx.auth())
      .expect(404);
  });
});
