import type { ConfigService } from '@nestjs/config';
import { FalAiAdapter } from '../../../src/publishing/adapters/fal-ai.adapter';

describe('FalAiAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a reference image to the Fal edit route and downloads the result', async () => {
    const fetchMock = mockFalQueue();
    const adapter = new FalAiAdapter(config());

    const result = await adapter.generate({
      prompt: 'Retrato del mismo personaje en un bosque',
      width: 1536,
      height: 1024,
      seed: 123,
      referenceImageUrl: 'https://cdn.test/reference.png',
    });

    const submitCall = fetchMock.mock.calls[0];
    expect(submitCall?.[0]).toBe(
      'https://queue.fal.run/fal-ai/nano-banana-pro/edit',
    );
    expect(submitCall?.[1]?.headers).toEqual({
      Authorization: 'Key test-fal-key',
      'Content-Type': 'application/json',
    });
    const body = submitCall?.[1]?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      throw new Error('Expected Fal submit body to be JSON');
    }
    expect(JSON.parse(body)).toMatchObject({
      prompt: 'Retrato del mismo personaje en un bosque',
      seed: 123,
      resolution: '1K',
      aspect_ratio: '3:2',
      image_urls: ['https://cdn.test/reference.png'],
    });
    expect(result.contentType).toBe('image/png');
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  it('uses the matching text-to-image route for previews without a reference', async () => {
    const fetchMock = mockFalQueue();
    const adapter = new FalAiAdapter(config());

    await adapter.generate({
      prompt: 'Una torre sobre la montaña',
      width: 512,
      height: 512,
      seed: 456,
    });

    const submitCall = fetchMock.mock.calls[0];
    expect(submitCall?.[0]).toBe(
      'https://queue.fal.run/fal-ai/nano-banana-pro',
    );
    const body = submitCall?.[1]?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') {
      throw new Error('Expected Fal submit body to be JSON');
    }
    expect(JSON.parse(body)).toMatchObject({
      resolution: '1K',
      aspect_ratio: '1:1',
    });
    expect(JSON.parse(body)).not.toHaveProperty('image_urls');
  });

  it('surfaces provider errors without retrying or making another provider call', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ error: 'invalid fal request' }, 422));
    const adapter = new FalAiAdapter(config());

    await expect(adapter.generate({ prompt: 'Una imagen' })).rejects.toThrow(
      'Fal API error: 422',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('identifies a network failure while downloading the generated image', async () => {
    const fetchMock = mockFalQueue(new TypeError('fetch failed'));
    const adapter = new FalAiAdapter(config());

    await expect(adapter.generate({ prompt: 'Una imagen' })).rejects.toThrow(
      'Error de red al descargar la imagen generada: fetch failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('identifies a network failure while submitting a generation request', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    const adapter = new FalAiAdapter(config());

    await expect(adapter.generate({ prompt: 'Una imagen' })).rejects.toThrow(
      'Error de red al enviar la solicitud de generación: fetch failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails before making a request when the API key is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const adapter = new FalAiAdapter(config({ FAL_API_KEY: '' }));

    await expect(adapter.generate({ prompt: 'Una imagen' })).rejects.toThrow(
      'Fal API key is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function config(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    FAL_API_KEY: 'test-fal-key',
    FAL_IMAGE_MODEL: 'fal-ai/nano-banana-pro/edit',
    FAL_BASE_URL: 'https://queue.fal.run',
    FAL_TIMEOUT_MS: '1000',
    FAL_POLL_INTERVAL_MS: '1',
    IMAGE_WIDTH: '1024',
    IMAGE_HEIGHT: '1024',
    ...overrides,
  };
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function mockFalQueue(
  imageDownloadError?: Error,
): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === 'https://cdn.test/generated.png') {
      if (imageDownloadError) {
        return Promise.reject(imageDownloadError);
      }
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    }
    if (url.includes('/requests/request-1/status')) {
      return Promise.resolve(jsonResponse({ status: 'COMPLETED' }));
    }
    if (url.includes('/requests/request-1/response')) {
      return Promise.resolve(
        jsonResponse({
          images: [
            {
              url: 'https://cdn.test/generated.png',
              content_type: 'image/png',
            },
          ],
        }),
      );
    }
    expect(init?.method).toBe('POST');
    return Promise.resolve(
      jsonResponse({
        request_id: 'request-1',
        status_url:
          'https://queue.fal.run/fal-ai/nano-banana-pro/edit/requests/request-1/status',
        response_url:
          'https://queue.fal.run/fal-ai/nano-banana-pro/edit/requests/request-1/response',
      }),
    );
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
