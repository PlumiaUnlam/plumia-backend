export const IMAGE_GENERATION = Symbol('IMAGE_GENERATION');

export interface ImageGenerationInput {
  prompt: string;
  width?: number;
  height?: number;
  model?: string;
}

export interface ImageGenerationResult {
  buffer: Buffer;
  contentType: string;
}

export interface ImageGeneration {
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
