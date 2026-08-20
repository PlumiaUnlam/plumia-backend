import { ImageGenerationEventsService } from '../../../src/publishing/workers/image-generation-events.service';

describe('ImageGenerationEventsService', () => {
  it('streams only events belonging to the connected user', () => {
    const service = new ImageGenerationEventsService();
    const received: unknown[] = [];
    const subscription = service.streamForUser('user-1').subscribe((event) => {
      received.push(event);
    });

    service.publish({
      jobId: 'job-1',
      entityId: 'entity-1',
      userId: 'user-2',
      status: 'PROCESSING',
      progress: 10,
    });
    service.publish({
      jobId: 'job-2',
      entityId: 'entity-2',
      userId: 'user-1',
      status: 'COMPLETED',
      progress: 100,
    });

    expect(received).toEqual([
      {
        type: 'image-generation',
        data: {
          jobId: 'job-2',
          entityId: 'entity-2',
          userId: 'user-1',
          status: 'COMPLETED',
          progress: 100,
        },
      },
    ]);
    subscription.unsubscribe();
  });
});
