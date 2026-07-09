import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ImageGeneration,
  ImageGenerationInput,
  ImageGenerationResult,
} from '../ports/image-generation.port';
export { IMAGE_GENERATION } from '../ports/image-generation.port';

const GENERATION_TIMEOUT_MS = 30_000;

@Injectable()
export class PollinationsAdapter implements ImageGeneration {
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'POLLINATIONS_BASE_URL',
      'https://image.pollinations.ai/p',
    );
    this.defaultModel = this.config.get<string>('POLLINATIONS_MODEL', 'flux');
    this.defaultWidth = Number(this.config.get<string>('IMAGE_WIDTH', '512'));
    this.defaultHeight = Number(this.config.get<string>('IMAGE_HEIGHT', '512'));
  }

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const width = input.width ?? this.defaultWidth;
    const height = input.height ?? this.defaultHeight;
    const model = input.model ?? this.defaultModel;

    const cleanPrompt = input.prompt.replace(/[\n*]/g, ' ').trim();
    const encodedPrompt = encodeURIComponent(cleanPrompt);

    const url = `${this.baseUrl}/${encodedPrompt}?width=${width}&height=${height}&enhance=false&model=${model}&nofeed=true&nocache=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(
          `Pollinations API error: ${response.status} ${response.statusText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') ?? 'image/jpeg';

      return { buffer, contentType };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `Pollinations API timeout after ${GENERATION_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
