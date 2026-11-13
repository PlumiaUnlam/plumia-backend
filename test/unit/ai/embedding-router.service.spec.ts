import type { ConfigService } from '@nestjs/config';

const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { embedContent: mockEmbedContent },
  })),
}));

import { AiChainExhaustedError } from '../../../src/ai/ai-errors';
import { EmbeddingRouter } from '../../../src/ai/embedding-router.service';
import { AiApplicationHelpEmbeddingAdapter } from '../../../src/chat/adapters/ai-application-help-embedding.adapter';
import { AiEmbeddingAdapter } from '../../../src/chat/adapters/ai-embedding.adapter';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

const vector = (seed: number): number[] =>
  Array.from({ length: 1_536 }, (_value, index) => (index + seed) / 1_536);

function openRouterEmbeddings(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({
      data: vectors.map((embedding, index) => ({ index, embedding })),
    }),
    { status: 200 },
  );
}

const keys = { OPENROUTER_API_KEY: 'or-key', GEMINI_API_KEY: 'gemini-key' };

describe('EmbeddingRouter', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    mockEmbedContent.mockReset();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('keeps the indexed embedding space and profile whichever route answers', () => {
    const router = new EmbeddingRouter(config(keys));

    expect(new AiEmbeddingAdapter(router).model).toBe('gemini-embedding-2');
    expect(new AiApplicationHelpEmbeddingAdapter(router).profile).toBe(
      'gemini-embedding-2:application-help-qa-v1:1536',
    );
  });

  it('asks OpenRouter first for the same model and dimensions', async () => {
    fetchMock.mockResolvedValue(openRouterEmbeddings([vector(1), vector(2)]));
    const adapter = new AiEmbeddingAdapter(new EmbeddingRouter(config(keys)));

    await expect(adapter.embedDocuments(['uno', 'dos'])).resolves.toEqual([
      vector(1),
      vector(2),
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'google/gemini-embedding-2',
      input: ['uno', 'dos'],
      dimensions: 1_536,
    });
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it('falls back to the Gemini API when OpenRouter fails or answers badly', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(openRouterEmbeddings([[0.1, 0.2]]));
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: vector(3) }],
    });
    const adapter = new AiEmbeddingAdapter(new EmbeddingRouter(config(keys)));

    await expect(adapter.embedQuery('pregunta')).resolves.toEqual(vector(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-embedding-2',
        contents: [{ role: 'user', parts: [{ text: 'pregunta' }] }],
        config: expect.objectContaining({
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 1_536,
        }) as unknown,
      }),
    );
  });

  it('writes the help task into the text so every route returns the same vector', async () => {
    fetchMock.mockResolvedValue(openRouterEmbeddings([vector(4)]));
    const adapter = new AiApplicationHelpEmbeddingAdapter(
      new EmbeddingRouter(config(keys)),
    );

    await adapter.embedDocuments([{ title: 'Exportar', content: 'EPUB' }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      input: ['title: Exportar | text: EPUB'],
    });
  });

  it('fails after every compatible route was tried', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 500 })),
    );
    mockEmbedContent.mockRejectedValue(
      Object.assign(new Error('Quota'), { status: 429 }),
    );
    const router = new EmbeddingRouter(config(keys));

    await expect(router.embed(['texto'])).rejects.toBeInstanceOf(
      AiChainExhaustedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  it('is not configured without keys', () => {
    expect(new EmbeddingRouter(config({})).isConfigured()).toBe(false);
  });
});
