import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ImageGeneration,
  ImageGenerationInput,
  ImageGenerationResult,
} from '../ports/image-generation.port';
import { createImageSeed, fetchWithTimeout } from '../image-publishing.utils';

const DEFAULT_MODEL = 'fal-ai/nano-banana-pro/edit';
const DEFAULT_BASE_URL = 'https://queue.fal.run';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

const ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
] as const;

type FalAspectRatio = (typeof ASPECT_RATIOS)[number] | 'auto';
type FalResolution = '1K' | '2K' | '4K';

interface FalSubmitResponse {
  request_id?: unknown;
  response_url?: unknown;
  status_url?: unknown;
}

interface FalStatusResponse {
  status?: unknown;
  response_url?: unknown;
}

interface FalResultResponse {
  images?: unknown;
}

@Injectable()
export class FalAiAdapter implements ImageGeneration {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;

  constructor(private readonly config: ConfigService) {
    const configuredApiKey = this.config.get<string>('FAL_API_KEY')?.trim();
    const legacyApiKey = this.config.get<string>('FAL_KEY')?.trim();
    this.apiKey = this.resolveApiKey(configuredApiKey, legacyApiKey);
    this.baseUrl = this.config.get<string>('FAL_BASE_URL', DEFAULT_BASE_URL);
    this.defaultModel = this.config.get<string>(
      'FAL_IMAGE_MODEL',
      DEFAULT_MODEL,
    );
    this.timeoutMs = this.readPositiveNumber(
      'FAL_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    );
    this.pollIntervalMs = this.readPositiveNumber(
      'FAL_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.defaultWidth = this.readPositiveNumber('IMAGE_WIDTH', 1024);
    this.defaultHeight = this.readPositiveNumber('IMAGE_HEIGHT', 1024);
  }

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Fal API key is not configured');
    }

    const width = input.width ?? this.defaultWidth;
    const height = input.height ?? this.defaultHeight;
    const configuredModel = input.model ?? this.defaultModel;
    // Fal exposes separate text-to-image and image-edit routes for Nano Banana.
    // Preview jobs do not have a reference, so use the matching text route.
    const model = input.referenceImageUrl
      ? configuredModel
      : configuredModel.replace(/\/edit\/?$/, '');
    const payload = {
      prompt: input.prompt.replace(/[\n*]/g, ' ').trim(),
      seed: input.seed ?? createImageSeed(),
      output_format: 'png' as const,
      resolution: this.resolveResolution(width, height),
      aspect_ratio: this.resolveAspectRatio(width, height),
      ...(input.referenceImageUrl
        ? { image_urls: [input.referenceImageUrl] }
        : {}),
    };

    const modelUrl = `${this.baseUrl.replace(/\/$/, '')}/${model}`;
    const submit = await this.requestJson<FalSubmitResponse>(
      modelUrl,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      },
      'enviar la solicitud de generación',
    );
    const requestId = this.readString(submit.request_id);
    if (!requestId) {
      throw new Error('Fal API error: response did not include request_id');
    }

    const responseUrl = this.readString(submit.response_url);
    const statusUrl =
      this.readString(submit.status_url) ??
      `${modelUrl}/requests/${encodeURIComponent(requestId)}/status`;
    const resultUrl =
      responseUrl ??
      `${modelUrl}/requests/${encodeURIComponent(requestId)}/response`;
    const deadline = Date.now() + this.timeoutMs;

    await this.pollUntilComplete(statusUrl, deadline);

    if (Date.now() >= deadline) {
      throw new Error(`Fal API timeout after ${this.timeoutMs / 1000}s`);
    }

    const result = await this.requestJson<FalResultResponse>(
      resultUrl,
      {
        headers: this.headers(),
      },
      'obtener el resultado de la generación',
    );
    const image = this.readImage(result.images);
    let imageResponse: Response;
    try {
      imageResponse = await fetchWithTimeout(image.url, {
        headers: { Accept: 'image/*' },
        timeoutMs: this.timeoutMs,
      });
    } catch (error: unknown) {
      throw this.networkError('descargar la imagen generada', error);
    }
    if (!imageResponse.ok) {
      throw new Error(
        `Fal API error: could not download generated image (${imageResponse.status})`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    } catch (error: unknown) {
      throw this.networkError('leer la imagen generada', error);
    }

    return {
      buffer,
      contentType:
        imageResponse.headers.get('content-type') ??
        image.contentType ??
        'image/png',
    };
  }

  private async requestJson<T>(
    url: string,
    options: RequestInit,
    stage: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        ...options,
        timeoutMs: this.timeoutMs,
      });
    } catch (error: unknown) {
      throw this.networkError(stage, error);
    }
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = body ? (JSON.parse(body) as unknown) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const detail = body.replace(/\s+/g, ' ').trim().slice(0, 300);
      const detailSuffix = detail ? ` - ${detail}` : '';
      throw new Error(
        `Fal API error: ${response.status} ${response.statusText}${detailSuffix}`,
      );
    }
    return parsed as T;
  }

  private resolveApiKey(
    configuredApiKey: string | undefined,
    legacyApiKey: string | undefined,
  ): string | null {
    if (configuredApiKey && configuredApiKey.length > 0) {
      return configuredApiKey;
    }
    if (legacyApiKey && legacyApiKey.length > 0) {
      return legacyApiKey;
    }
    return null;
  }

  private async pollUntilComplete(
    statusUrl: string,
    deadline: number,
  ): Promise<void> {
    if (Date.now() >= deadline) {
      return;
    }

    const status = await this.requestJson<FalStatusResponse>(
      statusUrl,
      {
        headers: this.headers(),
      },
      'consultar el estado de la generación',
    );
    const state = this.readString(status.status);
    if (state === 'COMPLETED') {
      return;
    }
    if (state === 'FAILED' || state === 'CANCELED' || state === 'CANCELLED') {
      throw new Error(`Fal API error: request ${state.toLowerCase()}`);
    }

    await this.sleep(this.pollIntervalMs);
    return this.pollUntilComplete(statusUrl, deadline);
  }

  private networkError(stage: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` (${error.cause.message})`
        : '';
    return new Error(`Error de red al ${stage}: ${message}${cause}`, {
      cause: error,
    });
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Key ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private readImage(value: unknown): {
    url: string;
    contentType: string | null;
  } {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('Fal API error: response did not include an image');
    }
    const first: unknown = (value as unknown[])[0];
    if (!this.isRecord(first)) {
      throw new Error('Fal API error: invalid image response');
    }
    const url = this.readString(first['url']);
    if (!url) {
      throw new Error('Fal API error: image response did not include a URL');
    }
    return {
      url,
      contentType: this.readString(first['content_type']),
    };
  }

  private resolveAspectRatio(width: number, height: number): FalAspectRatio {
    if (width <= 0 || height <= 0) {
      return 'auto';
    }
    const ratio = width / height;
    const closest = ASPECT_RATIOS.reduce<{
      value: FalAspectRatio;
      distance: number;
    }>(
      (best, value) => {
        const [w = 1, h = 1] = value.split(':').map(Number);
        const distance = Math.abs(ratio - w / h);
        return distance < best.distance ? { value, distance } : best;
      },
      { value: 'auto', distance: Number.POSITIVE_INFINITY },
    );
    return closest.distance <= 0.04 ? closest.value : 'auto';
  }

  private resolveResolution(width: number, height: number): FalResolution {
    const longestSide = Math.max(width, height);
    if (longestSide <= 1536) {
      return '1K';
    }
    if (longestSide <= 3072) {
      return '2K';
    }
    return '4K';
  }

  private readPositiveNumber(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name, String(fallback)));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
