import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';
import { PublishingService } from '../../../src/publishing/publishing.service';

interface ImageResponse {
  id: string;
  entityId: string;
  isPrimary: boolean;
}

interface ImageGenerationJobResponse {
  id: string;
  entityId: string;
  status: string;
  progress: number;
  generatedImage: ImageResponse | null;
}

describe('Publishing image endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  beforeAll(() => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('queues a generation and persists its generated image in the entity gallery', async () => {
    const { entity } = await ctx.createProjectTree();

    const requestResponse = await request(ctx.server)
      .post('/publishing/images/generate')
      .set(ctx.auth())
      .send({
        entityId: entity.id,
        expression: 'Sonriente',
        pose: 'De perfil',
        background: 'Bosque',
      })
      .expect(202);
    const queued = responseBody<ImageGenerationJobResponse>(requestResponse);
    expect(queued).toMatchObject({
      entityId: entity.id,
      status: 'QUEUED',
      progress: 0,
      generatedImage: null,
    });

    await ctx.app.get(PublishingService).processImageGeneration(queued.id);

    await request(ctx.server)
      .get(`/publishing/images/jobs/${queued.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ImageGenerationJobResponse>(response);
        expect(body).toMatchObject({
          entityId: entity.id,
          status: 'COMPLETED',
          progress: 100,
          generatedImage: { entityId: entity.id, isPrimary: true },
        });
      });

    await request(ctx.server)
      .get(`/publishing/images/${entity.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ImageResponse[]>(response);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ entityId: entity.id, isPrimary: true });
      });
  });

  it('attaches, lists and selects primary entity images', async () => {
    const { entity } = await ctx.createProjectTree();

    const attachResponse = await request(ctx.server)
      .post('/publishing/images/attach')
      .set(ctx.auth())
      .send({
        entityId: entity.id,
        storageKey: `entities/${entity.id}/portrait.png`,
        prompt: 'Portrait',
        imageType: 'image/png',
      })
      .expect(201);

    const attachBody = responseBody<ImageResponse>(attachResponse);
    const imageId = attachBody.id;
    expect(attachBody).toMatchObject({
      entityId: entity.id,
      isPrimary: true,
    });

    await request(ctx.server)
      .get(`/publishing/images/${entity.id}`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<ImageResponse[]>(response);
        const firstImage = body[0];
        if (!firstImage) {
          throw new Error('Expected the attached image to be listed');
        }
        expect(firstImage).toMatchObject({ id: imageId });
      });

    await request(ctx.server)
      .post(`/publishing/images/${entity.id}/primary`)
      .set(ctx.auth())
      .send({ imageId })
      .expect(201)
      .expect((response) => {
        const body = responseBody<ImageResponse>(response);
        expect(body).toMatchObject({ id: imageId, isPrimary: true });
      });
  });
});
