import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';

interface ImageResponse {
  id: string;
  entityId: string;
  isPrimary: boolean;
}

describe('Publishing image endpoints e2e', () => {
  const ctx = createEndpointTestContext();

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
