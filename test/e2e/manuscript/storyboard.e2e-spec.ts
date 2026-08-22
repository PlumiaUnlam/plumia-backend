import request from 'supertest';
import { StorageService } from '../../../src/storage/storage.service';
import {
  createEndpointTestContext,
  responseBody,
  type StoryboardArcResponse,
  type StoryboardCardResponse,
  type StoryboardMatrixNoteResponse,
} from '../endpoint-test-context';

describe('Storyboard endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  interface StorageTestDouble {
    deleteObject: jest.Mock;
    hasUploaded: (key: string) => boolean;
    markUploaded: (key: string) => void;
  }

  it('creates, lists, updates and deletes storyboard cards', async () => {
    const { project, chapter, entity } = await ctx.createProjectTree();

    const createResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .send({
        title: 'Opening beat',
        description: 'Introduce the central promise',
        status: 'planned',
        tags: ['setup'],
        characters: ['Hero'],
        entityIds: [entity.id],
        chapterId: chapter.id,
      })
      .expect(201);

    const card = responseBody<StoryboardCardResponse>(createResponse);
    expect(card).toMatchObject({
      projectId: project.id,
      chapterId: chapter.id,
      title: 'Opening beat',
      status: 'planned',
      entityIds: [entity.id],
    });

    await request(ctx.server)
      .get(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse[]>(response);
        expect(body.some((item) => item.id === card.id)).toBe(true);
      });

    await request(ctx.server)
      .patch(`/storyboard-cards/${card.id}`)
      .set(ctx.auth())
      .send({ title: 'Revised beat', status: 'in-progress' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse>(response);
        expect(body).toMatchObject({
          id: card.id,
          title: 'Revised beat',
          status: 'in-progress',
        });
      });

    await request(ctx.server)
      .delete(`/storyboard-cards/${card.id}`)
      .set(ctx.auth())
      .expect(204);
  });

  it('transcribes, persists, serves and deletes a storyboard voice note', async () => {
    const project = await ctx.createProject();
    const storage = ctx.app.get<StorageService, StorageTestDouble>(
      StorageService,
    );

    const transcriptionResponse = await request(ctx.server)
      .post('/speech-to-text/transcribe')
      .set(ctx.auth())
      .attach('audio', Buffer.from('fake-webm-audio'), {
        filename: 'voice-note.webm',
        contentType: 'audio/webm',
      })
      .expect(201);

    const transcription = responseBody<{ text: string }>(transcriptionResponse);
    expect(transcription.text).toContain('puerta secreta');

    const createResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .send({
        title: 'Puerta secreta',
        description: transcription.text,
        status: 'ideas',
      })
      .expect(201);
    const card = responseBody<StoryboardCardResponse>(createResponse);

    const uploadResponse = await request(ctx.server)
      .post('/storage/presigned-upload')
      .set(ctx.auth())
      .send({
        entityId: card.id,
        filename: 'voice-note.webm',
        contentType: 'audio/webm',
        storageFolder: 'storyboard-audio',
      })
      .expect(200);
    const upload = responseBody<{
      presignedUrl: string;
      storageKey: string;
    }>(uploadResponse);

    expect(upload.presignedUrl).toContain('https://storage.test/upload');
    expect(upload.storageKey).toBe(
      `storyboard-audio/${card.id}/voice-note.webm`,
    );

    storage.markUploaded(upload.storageKey);

    await request(ctx.server)
      .post(`/storyboard-cards/${card.id}/audio`)
      .set(ctx.auth())
      .send({
        audioStorageKey: upload.storageKey,
        audioDurationSecs: 6,
      })
      .expect(201)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse>(response);
        expect(body).toMatchObject({
          id: card.id,
          description: transcription.text,
          hasAudio: true,
          audioDurationSecs: 6,
        });
      });

    await request(ctx.server)
      .get(`/storyboard-cards/${card.id}/audio`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        expect(responseBody<{ url: string }>(response).url).toBe(
          `https://storage.test/get/${upload.storageKey}`,
        );
      });

    await request(ctx.server)
      .get(`/projects/${project.id}/storyboard-cards`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardCardResponse[]>(response);
        expect(body.find((item) => item.id === card.id)).toMatchObject({
          hasAudio: true,
          audioDurationSecs: 6,
        });
      });

    storage.deleteObject.mockClear();
    await request(ctx.server)
      .delete(`/storyboard-cards/${card.id}`)
      .set(ctx.auth())
      .expect(204);

    expect(storage.deleteObject).toHaveBeenCalledWith(upload.storageKey);
    expect(storage.hasUploaded(upload.storageKey)).toBe(false);
    await request(ctx.server)
      .get(`/storyboard-cards/${card.id}/audio`)
      .set(ctx.auth())
      .expect(404);
  });

  it('creates, lists, updates and deletes storyboard matrix arcs and notes', async () => {
    const { project, chapter, entity } = await ctx.createProjectTree();

    const arcResponse = await request(ctx.server)
      .post(`/projects/${project.id}/storyboard-arcs`)
      .set(ctx.auth())
      .send({
        title: 'Hero arc',
        sourceType: 'entity',
        entityId: entity.id,
      })
      .expect(201);

    const arc = responseBody<StoryboardArcResponse>(arcResponse);
    expect(arc).toMatchObject({
      projectId: project.id,
      title: 'Hero arc',
      sourceType: 'entity',
      entityId: entity.id,
    });

    const noteResponse = await request(ctx.server)
      .post(`/storyboard-arcs/${arc.id}/notes`)
      .set(ctx.auth())
      .send({ chapterId: chapter.id, content: 'Learns the cost of hiding' })
      .expect(201);

    const note = responseBody<StoryboardMatrixNoteResponse>(noteResponse);
    expect(note).toMatchObject({
      arcId: arc.id,
      chapterId: chapter.id,
      content: 'Learns the cost of hiding',
    });

    await request(ctx.server)
      .get(`/projects/${project.id}/storyboard-arcs`)
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardArcResponse[]>(response);
        const firstArc = body[0];
        if (!firstArc) {
          throw new Error('Expected the storyboard arc to be listed');
        }
        expect(firstArc).toMatchObject({ id: arc.id });
        const firstNote = firstArc.notes[0];
        if (!firstNote) {
          throw new Error('Expected the storyboard arc to contain a note');
        }
        expect(firstNote).toMatchObject({ id: note.id });
      });

    await request(ctx.server)
      .patch(`/storyboard-matrix-notes/${note.id}`)
      .set(ctx.auth())
      .send({ content: 'Chooses the hard truth' })
      .expect(200)
      .expect((response) => {
        const body = responseBody<StoryboardMatrixNoteResponse>(response);
        expect(body).toMatchObject({
          id: note.id,
          content: 'Chooses the hard truth',
        });
      });

    await request(ctx.server)
      .delete(`/storyboard-matrix-notes/${note.id}`)
      .set(ctx.auth())
      .expect(204);

    await request(ctx.server)
      .delete(`/storyboard-arcs/${arc.id}`)
      .set(ctx.auth())
      .expect(204);
  });
});
