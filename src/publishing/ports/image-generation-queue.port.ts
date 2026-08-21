export const IMAGE_GENERATION_QUEUE = Symbol('IMAGE_GENERATION_QUEUE');

export interface ImageGenerationQueueJobData {
  imageGenerationJobId: string;
}

export interface ImageGenerationQueue {
  enqueueGeneration(jobId: string): Promise<void>;
}
