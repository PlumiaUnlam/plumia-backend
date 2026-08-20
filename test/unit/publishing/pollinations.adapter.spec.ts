import type { ConfigService } from '@nestjs/config';
import { PollinationsAdapter } from '../../../src/publishing/adapters/pollinations.adapter';

describe('PollinationsAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps Pollinations and sends the stable seed and reference image', async () => {
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    const adapter = new PollinationsAdapter(config);
    let requestUrl = '';
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    });

    const result = await adapter.generate({
      prompt: 'Retrato del mismo personaje',
      width: 512,
      height: 512,
      seed: 123,
      referenceImageUrl: 'https://cdn.test/reference.png',
    });

    expect(requestUrl).toContain('image.pollinations.ai/p/');
    expect(requestUrl).toContain('seed=123');
    expect(requestUrl).toContain(
      'image=https%3A%2F%2Fcdn.test%2Freference.png',
    );
    expect(result.contentType).toBe('image/png');
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
  });
});
