import type { ConfigService } from '@nestjs/config';

const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { embedContent: mockEmbedContent },
  })),
}));

import { GeminiEmbeddingAdapter } from '../../../src/chat/adapters/gemini-embedding.adapter';

interface EmbeddingRequest {
  config?: { taskType?: string };
}

describe('GeminiEmbeddingAdapter', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
  });

  it('creates 1536-dimensional document and query embeddings with distinct task types', async () => {
    const vector = Array.from({ length: 1_536 }, (_, index) => index / 1_536);
    mockEmbedContent
      .mockResolvedValueOnce({ embeddings: [{ values: vector }] })
      .mockResolvedValueOnce({ embeddings: [{ values: vector }] });
    const adapter = new GeminiEmbeddingAdapter(config());

    await expect(adapter.embedDocuments(['Fragmento'])).resolves.toEqual([
      vector,
    ]);
    await expect(adapter.embedQuery('Consulta')).resolves.toEqual(vector);

    expect(mockEmbedContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'gemini-embedding-2',
        contents: ['Fragmento'],
        config: {
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 1_536,
        },
      }),
    );
    const requests = mockEmbedContent.mock.calls as Array<[EmbeddingRequest]>;
    expect(requests[1]?.[0].config?.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('rejects incomplete and incorrectly sized embedding responses', async () => {
    const adapter = new GeminiEmbeddingAdapter(config());
    mockEmbedContent.mockResolvedValueOnce({ embeddings: [] });
    await expect(adapter.embedDocuments(['Fragmento'])).rejects.toThrow(
      'incomplete embedding batch',
    );

    mockEmbedContent.mockResolvedValueOnce({ embeddings: [{ values: [0.1] }] });
    await expect(adapter.embedQuery('Consulta')).rejects.toThrow(
      'invalid embedding dimension',
    );
  });

  it('is explicitly disabled and makes no request without an API key', async () => {
    const adapter = new GeminiEmbeddingAdapter(config(false));

    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.embedDocuments(['Fragmento'])).resolves.toEqual([]);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });
});

function config(includeApiKey = true): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'GEMINI_API_KEY' && includeApiKey) {
        return 'test-key';
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}
