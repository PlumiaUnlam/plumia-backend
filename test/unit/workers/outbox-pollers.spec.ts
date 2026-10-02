/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PendingOutboxEvent } from '../../../src/common/workers/outbox-poller';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { SummaryOutboxPoller } from '../../../src/summary/workers/summary-outbox-poller.service';
import { ImageGenerationOutboxPoller } from '../../../src/publishing/workers/image-generation-outbox-poller.service';
import { ExportOutboxPoller } from '../../../src/publishing/exports/workers/export-outbox-poller.service';
import { StoryboardAudioCleanupPoller } from '../../../src/manuscript/workers/storyboard-audio-cleanup-poller.service';

const event = (
  overrides: Partial<PendingOutboxEvent> = {},
): PendingOutboxEvent => ({
  id: 'outbox-1',
  aggregateId: 'aggregate-1',
  payload: {},
  ...overrides,
});
const process = (poller: object, value: PendingOutboxEvent): Promise<void> =>
  (
    poller as { processEvent(input: PendingOutboxEvent): Promise<void> }
  ).processEvent(value);

describe('outbox poller event handling', () => {
  let prisma: {
    outbox: { update: jest.Mock };
    storyboardNote: { findFirst: jest.Mock };
  };
  let storage: { deleteObject: jest.Mock };

  beforeEach(() => {
    prisma = {
      outbox: { update: jest.fn().mockResolvedValue({}) },
      storyboardNote: { findFirst: jest.fn() },
    };
    storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('enqueues summary invalidation only when both identifiers are valid, then marks the event', async () => {
    const queue = {
      enqueueInvalidation: jest.fn().mockResolvedValue(undefined),
    };
    const poller = new SummaryOutboxPoller(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      queue as never,
    );

    await process(
      poller,
      event({ payload: { sceneId: 'scene-1', chapterId: 'chapter-1' } }),
    );
    expect(queue.enqueueInvalidation).toHaveBeenCalledWith(
      'scene-1',
      'chapter-1',
    );
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: expect.any(Date) },
    });

    queue.enqueueInvalidation.mockClear();
    prisma.outbox.update.mockClear();
    await process(
      poller,
      event({
        id: 'bad-payload',
        payload: { sceneId: 'scene-1', chapterId: 4 },
      }),
    );
    expect(queue.enqueueInvalidation).not.toHaveBeenCalled();
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'bad-payload' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it.each([
    ['image generation', ImageGenerationOutboxPoller],
    ['export', ExportOutboxPoller],
  ])(
    'marks %s events after success and queue duplicates, leaving transient errors for retry',
    async (_label, Poller) => {
      const enqueue = jest.fn().mockResolvedValue(undefined);
      const queue = { enqueueGeneration: enqueue, enqueueExport: enqueue };
      const poller = new Poller(
        {} as ConfigService,
        prisma as unknown as PrismaService,
        queue,
      );

      await process(poller, event());
      expect(enqueue).toHaveBeenCalledWith('aggregate-1');
      expect(prisma.outbox.update).toHaveBeenCalledTimes(1);

      enqueue.mockRejectedValueOnce(new Error('Job already exists'));
      await process(poller, event({ id: 'duplicate' }));
      expect(prisma.outbox.update).toHaveBeenLastCalledWith({
        where: { id: 'duplicate' },
        data: { processedAt: expect.any(Date) },
      });

      prisma.outbox.update.mockClear();
      enqueue.mockRejectedValueOnce(new Error('Redis unavailable'));
      await expect(
        process(poller, event({ id: 'retry' })),
      ).resolves.toBeUndefined();
      expect(prisma.outbox.update).not.toHaveBeenCalled();
    },
  );

  it('marks empty cleanup events and events whose audio is still referenced', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const poller = new StoryboardAudioCleanupPoller(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );

    await process(poller, event({ payload: { storageKey: '' } }));
    expect(prisma.outbox.update).toHaveBeenCalledTimes(1);
    expect(prisma.storyboardNote.findFirst).not.toHaveBeenCalled();

    prisma.storyboardNote.findFirst.mockResolvedValue({ id: 'note-1' });
    await process(
      poller,
      event({
        id: 'referenced',
        payload: { storageKey: 'storyboard-audio/card-1/a.webm' },
      }),
    );
    expect(prisma.storyboardNote.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        audioStorageKey: 'storyboard-audio/card-1/a.webm',
      },
      select: { id: true },
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.outbox.update).toHaveBeenLastCalledWith({
      where: { id: 'referenced' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('deletes unreferenced audio and leaves failures unprocessed for a later retry', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const poller = new StoryboardAudioCleanupPoller(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    prisma.storyboardNote.findFirst.mockResolvedValue(null);
    const storageKey = 'storyboard-audio/card-1/a.webm';

    await process(poller, event({ payload: { storageKey } }));
    expect(storage.deleteObject).toHaveBeenCalledWith(storageKey);
    expect(prisma.outbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: expect.any(Date) },
    });

    prisma.outbox.update.mockClear();
    storage.deleteObject.mockRejectedValueOnce(new Error('R2 offline'));
    await process(poller, event({ id: 'retry', payload: { storageKey } }));
    expect(prisma.outbox.update).not.toHaveBeenCalled();
  });
});
