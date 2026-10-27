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

const mockAnthropicCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    beta: { messages: { create: mockAnthropicCreate } },
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

  it('keeps narrative relevance separate from identification confidence', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        entities: [
          {
            canonicalName: 'Mapa del Santuario',
            aliases: [],
            type: 'OBJECT',
            description: 'Un mapa unico.',
            attributes: {},
            imageUrl: null,
            confidenceScore: 0.92,
            narrativeRelevance: 0.88,
            evidence: ['Mira el mapa.'],
            normalizedName: 'mapa del santuario',
          },
        ],
        stateChanges: [],
        relationships: [],
        inconsistencies: [],
      }),
    });
    const { client } = createClient({
      ENTITY_EXTRACTION_API_KEY: 'server-key',
      ENTITY_EXTRACTION_MODEL: 'gemini-test',
    });

    const result = await client.extractEntities(input);

    expect(result.entities[0]).toMatchObject({
      confidenceScore: 0.92,
      narrativeRelevance: 0.88,
    });
    interface GenerationRequest {
      config: {
        responseJsonSchema: {
          properties: {
            entities: {
              items: { properties: { narrativeRelevance: unknown } };
            };
          };
        };
      };
    }
    const calls = mockGenerateContent.mock.calls as unknown as Array<
      [GenerationRequest]
    >;
    const request = calls[0]?.[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error('Expected a generation request');
    }
    expect(
      request.config.responseJsonSchema.properties.entities.items.properties,
    ).toHaveProperty('narrativeRelevance');
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

  it('prefers the user Gemini key over the Anthropic server provider', async () => {
    const { client } = createClient(
      {
        ENTITY_EXTRACTION_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'anthropic-key',
        ENTITY_EXTRACTION_MODEL: 'claude-opus-5-5',
      },
      'user-key',
    );

    await client.extractEntities(input);

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'user-key' }),
    );
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
    );
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('runs audits through Claude with closed schemas when the user has no key', async () => {
    mockAnthropicCreate.mockResolvedValue({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"contradictions":[]}' }],
    });
    const { client } = createClient({
      ENTITY_EXTRACTION_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'anthropic-key',
    });

    await expect(
      client.auditSceneChunkGroup({
        userId: 'user-id',
        chunks: [{ chunkIndex: 0, text: 'Texto.' }],
        knownEntities: [],
      }),
    ).resolves.toEqual([]);

    expect(mockGenerateContent).not.toHaveBeenCalled();
    const [request] = mockAnthropicCreate.mock.calls[0] as [
      { model: string; output_config: { format: { schema: unknown } } },
    ];
    expect(request.model).toBe('claude-opus-5-5');
    const schema = JSON.stringify(request.output_config.format.schema);
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).not.toContain('minimum');
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
