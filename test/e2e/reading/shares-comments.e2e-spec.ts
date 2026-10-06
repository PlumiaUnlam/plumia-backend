import { ReaderCommentStatus, SharePermission } from '@prisma/client';
import request from 'supertest';
import {
  E2E_READER_EMAIL,
  E2E_READER_ID,
  E2E_READER_TOKEN,
} from '../e2e-test-utils';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';

interface CreatedShareResponse {
  id: string;
  slug: string;
  token: string;
}

interface CreatedCommentResponse {
  id: string;
  status: ReaderCommentStatus;
  replies: Array<{ body: string }>;
}

interface SharedManuscriptResponse {
  viewer: { isOwner: boolean; canComment: boolean };
  manuscript: {
    books: Array<{ chapters: Array<{ scenes: Array<{ id: string }> }> }>;
  };
}

interface CommentStatusResponse {
  status: ReaderCommentStatus;
}

interface SharedStorageUrlResponse {
  url: string;
}

describe('Reading invitation endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('shares a frozen book and exercises acceptance, comments, replies, permissions, storage access, and revocation', async () => {
    await ctx.prisma.user.create({
      data: {
        id: E2E_READER_ID,
        name: 'E2E Reader',
        lastname: 'User',
        displayName: 'E2E Reader',
        email: E2E_READER_EMAIL,
      },
    });
    const { book, scene } = await ctx.createProjectTree();
    const created = await request(ctx.server)
      .post(`/books/${book.id}/shares`)
      .set(ctx.auth())
      .send({
        email: 'reader@example.com',
        permission: SharePermission.COMMENT,
      })
      .expect(201)
      .then((response) => responseBody<CreatedShareResponse>(response));

    expect(created.id).toBeTruthy();
    expect(created.slug).toBeTruthy();
    expect(created.token).toBeTruthy();

    await request(ctx.server)
      .get(`/books/${book.id}/shares`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const shares = responseBody<Array<{ id: string }>>(response);
        expect(shares.map((share) => share.id)).toContain(created.id);
      });

    await request(ctx.server)
      .post(`/reading/invitations/${created.slug}/accept`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .send({ token: created.token })
      .expect(201)
      .expect((response) => {
        const body = responseBody<SharedManuscriptResponse>(response);
        expect(body.viewer).toEqual({
          isOwner: false,
          canComment: true,
        });
        expect(body.manuscript.books[0]?.chapters[0]?.scenes[0]?.id).toBe(
          scene.id,
        );
      });

    await request(ctx.server)
      .get(`/reading/invitations/${created.slug}`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .expect(200)
      .expect((response) => {
        const body = responseBody<SharedManuscriptResponse>(response);
        expect(body.viewer).toEqual({
          isOwner: false,
          canComment: true,
        });
      });

    const comment = await request(ctx.server)
      .post(`/reading/invitations/${created.slug}/comments`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .send({
        snapshotSceneId: scene.id,
        anchorFrom: 0,
        anchorTo: 4,
        selectedText: 'Once',
        body: 'Could you clarify this opening?',
      })
      .expect(201)
      .then((response) => responseBody<CreatedCommentResponse>(response));

    await request(ctx.server)
      .get(`/reading/invitations/${created.slug}/comments`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .expect(200)
      .expect((response) => {
        const comments = responseBody<CreatedCommentResponse[]>(response);
        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({
          id: comment.id,
          body: 'Could you clarify this opening?',
        });
      });

    await request(ctx.server)
      .post(
        `/reading/invitations/${created.slug}/comments/${comment.id}/replies`,
      )
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .send({ body: 'I added more context.' })
      .expect(201)
      .expect((response) => {
        const updated = responseBody<CreatedCommentResponse>(response);
        expect(updated.replies.map((reply) => reply.body)).toContain(
          'I added more context.',
        );
      });

    await request(ctx.server)
      .patch(`/reading/invitations/${created.slug}/comments/${comment.id}`)
      .set(ctx.auth())
      .send({ status: ReaderCommentStatus.RESOLVED })
      .expect(200)
      .expect((response) => {
        const body = responseBody<CommentStatusResponse>(response);
        expect(body.status).toBe(ReaderCommentStatus.RESOLVED);
      });

    await request(ctx.server)
      .post(`/reading/invitations/${created.slug}/storage-url`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .send({ storageKey: `scenes/${scene.id}/images/reference.png` })
      .expect(201)
      .expect((response) => {
        const body = responseBody<SharedStorageUrlResponse>(response);
        expect(body.url).toContain('https://storage.test/get/');
      });

    await request(ctx.server)
      .patch(`/books/${book.id}/shares/${created.id}`)
      .set(ctx.auth())
      .send({ permission: SharePermission.READ_ONLY })
      .expect(200);

    await request(ctx.server)
      .get(`/reading/invitations/${created.slug}`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .expect(200)
      .expect((response) => {
        const body = responseBody<SharedManuscriptResponse>(response);
        expect(body.viewer.canComment).toBe(false);
      });

    await request(ctx.server)
      .post(`/reading/invitations/${created.slug}/comments`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .send({
        snapshotSceneId: scene.id,
        anchorFrom: 0,
        anchorTo: 1,
        selectedText: 'O',
        body: 'This must be rejected.',
      })
      .expect(403);

    await request(ctx.server)
      .patch(`/books/${book.id}/shares/${created.id}`)
      .set(ctx.auth())
      .send({ permission: SharePermission.COMMENT })
      .expect(200);

    await request(ctx.server)
      .delete(`/books/${book.id}/shares/${created.id}`)
      .set(ctx.auth())
      .expect(204);

    await request(ctx.server)
      .get(`/reading/invitations/${created.slug}`)
      .set('Authorization', `Bearer ${E2E_READER_TOKEN}`)
      .set('x-share-token', created.token)
      .expect(410);
  });

  it('validates share payloads, invitation identity, and protected owner access', async () => {
    const { book } = await ctx.createProjectTree();

    await request(ctx.server)
      .post(`/books/${book.id}/shares`)
      .set(ctx.auth())
      .send({ email: 'not-an-email', permission: 'ADMIN' })
      .expect(400);

    await request(ctx.server)
      .post(`/books/${book.id}/shares`)
      .send({
        email: 'reader@example.com',
        permission: SharePermission.COMMENT,
      })
      .expect(401);

    await request(ctx.server)
      .post('/reading/invitations/missing/accept')
      .send({ token: 'any-token' })
      .expect(401);

    await request(ctx.server).get(`/books/${book.id}/shares`).expect(401);
  });
});
