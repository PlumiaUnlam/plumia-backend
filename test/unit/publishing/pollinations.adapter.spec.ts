import type { ConfigService } from '@nestjs/config';
import { PollinationsAdapter } from '../../../src/publishing/adapters/pollinations.adapter';

describe('PollinationsAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes reference generations to an image-capable Pollinations model', async () => {
    const config = {
      get: jest.fn((key: string, fallback: string) =>
        key === 'POLLINATIONS_REFERENCE_MODEL' ? 'kontext' : fallback,
      ),
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
    expect(requestUrl).toContain('model=kontext');
    expect(requestUrl).toContain('seed=123');
    expect(requestUrl).toContain(
      'image=https%3A%2F%2Fcdn.test%2Freference.png',
    );
    expect(result.contentType).toBe('image/png');
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  it('generates a different seed when the caller does not provide one', async () => {
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    const adapter = new PollinationsAdapter(config);
    const requestUrls: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      requestUrls.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    });

    await adapter.generate({ prompt: 'primera variante' });
    await adapter.generate({ prompt: 'segunda variante' });

    const seeds = requestUrls.map((url) =>
      Number(new URL(url).searchParams.get('seed')),
    );
    expect(seeds[0]).toBeGreaterThanOrEqual(0);
    expect(seeds[1]).toBeGreaterThanOrEqual(0);
    expect(seeds[0]).not.toBe(seeds[1]);
  });
});
