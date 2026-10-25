const mockGenerateContent = jest.fn();
const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      embedContent: mockEmbedContent,
    },
  })),
}));

import { GoogleGenAI } from '@google/genai';
import { EntityExtractionClient } from './entity-extraction.client';

const emptyResponse = JSON.stringify({
  entities: [],
  stateChanges: [],
  relationships: [],
  inconsistencies: [],
});

function createConfig(values: Record<string, string>): { get: jest.Mock } {
  const getConfigValue = (key: string, fallback = ''): string => {
    const value: string | undefined = values[key];
    return value ?? fallback;
  };

  return {
    get: jest.fn(getConfigValue),
  };
}

function createClient(
  values: Record<string, string>,
  userKey: string | null = null,
): {
  client: EntityExtractionClient;
  userApiKeys: { getActiveGeminiKey: jest.Mock };
} {
  const userApiKeys = {
    getActiveGeminiKey: jest.fn().mockResolvedValue(userKey),
  };
  const client = new EntityExtractionClient(
    createConfig(values) as never,
    userApiKeys as never,
  );
  return { client, userApiKeys };
}

describe('EntityExtractionClient user credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockResolvedValue({ text: emptyResponse });
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2] }],
    });
  });

  const input = {
    userId: 'user-id',
    sceneText: 'Una escena breve.',
    knownEntities: [],
  };

  it('uses the user Gemini key for extraction when configured', async () => {
    const { client, userApiKeys } = createClient(
      {
        ENTITY_EXTRACTION_API_KEY: 'server-key',
        ENTITY_EXTRACTION_MODEL: 'gemini-test',
      },
      'user-key',
    );

    await client.extractEntities(input);

    expect(userApiKeys.getActiveGeminiKey).toHaveBeenCalledWith('user-id');
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'user-key' }),
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('falls back to the server key when the user has no key', async () => {
    const { client } = createClient(
      {
        ENTITY_EXTRACTION_API_KEY: 'server-key',
        ENTITY_EXTRACTION_MODEL: 'gemini-test',
      },
      null,
    );

    await client.extractEntities(input);

    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'server-key' }),
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('can extract with only the user key and no server key', async () => {
    const { client } = createClient(
      {
        ENTITY_EXTRACTION_API_KEY: '',
        ENTITY_EXTRACTION_MODEL: 'gemini-test',
      },
      'user-key',
    );

    await expect(client.extractEntities(input)).resolves.toEqual({
      entities: [],
      stateChanges: [],
      relationships: [],
      inconsistencies: [],
    });
  });

  it('keeps embeddings on the server client', async () => {
    const { client, userApiKeys } = createClient(
      {
        ENTITY_EXTRACTION_API_KEY: 'server-key',
        ENTITY_EXTRACTION_MODEL: 'gemini-test',
        ENTITY_EXTRACTION_EMBEDDING_MODEL: 'embedding-test',
      },
      'user-key',
    );

    await client.createEmbedding('texto');

    expect(userApiKeys.getActiveGeminiKey).not.toHaveBeenCalled();
    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: 'embedding-test',
      contents: 'texto',
    });
  });

  it('does not silently use the server key when user-key lookup fails', async () => {
    const { client, userApiKeys } = createClient(
      {
        ENTITY_EXTRACTION_API_KEY: 'server-key',
        ENTITY_EXTRACTION_MODEL: 'gemini-test',
      },
      null,
    );
    userApiKeys.getActiveGeminiKey.mockRejectedValueOnce(
      new Error('stored key could not be decrypted'),
    );

    await expect(client.extractEntities(input)).rejects.toThrow(
      'stored key could not be decrypted',
    );
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
