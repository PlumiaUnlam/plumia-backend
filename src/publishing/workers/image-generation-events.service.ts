import { Injectable } from '@nestjs/common';
import { Subject, filter, map, type Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

export interface ImageGenerationEvent {
  jobId: string;
  entityId: string;
  userId: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  errorMessage?: string;
}

@Injectable()
export class ImageGenerationEventsService {
  private readonly events = new Subject<ImageGenerationEvent>();

  publish(event: ImageGenerationEvent): void {
    this.events.next(event);
  }

  streamForUser(userId: string): Observable<MessageEvent> {
    return this.events.pipe(
      filter((event) => event.userId === userId),
      map((event) => ({
        type: 'image-generation',
        data: event,
      })),
    );
  }
}
