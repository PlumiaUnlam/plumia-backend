import request from 'supertest';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';

interface PresignedUploadResponse {
  presignedUrl: string;
  publicUrl: string;
}

interface PresignedDownloadResponse {
  url: string;
}

describe('Storage endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('creates storage presigned URLs and validates image ownership', async () => {
    const { entity } = await ctx.createProjectTree();

    await request(ctx.server)
      .post('/storage/presigned-upload')
      .set(ctx.auth())
      .send({
        entityId: entity.id,
        filename: 'portrait.png',
        contentType: 'image/png',
      })
      .expect(200)
      .expect((response) => {
        const body = responseBody<PresignedUploadResponse>(response);
        expect(body.presignedUrl).toContain('https://storage.test');
        expect(body.publicUrl).toContain('https://cdn.test');
      });

    await ctx.prisma.entity.update({
      where: { id: entity.id },
      data: {
        imageUrl: `https://cdn.test/test-bucket/entities/${entity.id}/portrait.png`,
      },
    });

    await request(ctx.server)
      .post('/storage/presigned-download')
      .set(ctx.auth())
      .send({ entityId: entity.id })
      .expect(200)
      .expect((response) => {
        const body = responseBody<PresignedDownloadResponse>(response);
        expect(body.url).toContain('https://storage.test/get');
      });
  });

  it('validates storage payloads', async () => {
    await request(ctx.server)
      .post('/storage/presigned-upload')
      .set(ctx.auth())
      .send({
        entityId: 'entity-id',
        filename: 'portrait.gif',
        contentType: 'image/gif',
      })
      .expect(400);
  });
});
