import type { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

import { GeminiChatGenerationAdapter } from '../../../src/chat/adapters/gemini-chat-generation.adapter';

interface GenerateRequest {
  model: string;
  config: {
    responseMimeType?: string;
    systemInstruction?: string;
    safetySettings?: unknown;
    abortSignal?: AbortSignal;
  };
}

describe('GeminiChatGenerationAdapter', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('uses the production model, structured output, and the security policy', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          {
            text: 'La cicatriz aparece en el capítulo uno.',
            evidence: [
              {
                sourceId: 'manuscript:1',
                quote: 'La cicatriz brilló.',
              },
            ],
          },
        ],
      }),
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8 },
    });
    const adapter = new GeminiChatGenerationAdapter(config());

    const result = await adapter.generate({
      question: '¿Dónde aparece la cicatriz?',
      history: [],
      sources: [
        {
          id: 'manuscript:1',
          kind: 'manuscript',
          label: 'Capítulo 1',
          excerpt: 'La cicatriz brilló.',
        },
      ],
    });

    expect(result).toEqual({
      answer: 'La cicatriz aparece en el capítulo uno.',
      sourceIds: ['manuscript:1'],
      claims: [
        {
          text: 'La cicatriz aparece en el capítulo uno.',
          evidence: [
            {
              sourceId: 'manuscript:1',
              quote: 'La cicatriz brilló.',
            },
          ],
        },
      ],
      inputTokens: 30,
      outputTokens: 8,
    });
    const requests = mockGenerateContent.mock.calls as Array<[GenerateRequest]>;
    const request = requests[0]?.[0];
    expect(request).toBeDefined();
    if (!request) {
      return;
    }
    expect(request.model).toBe('gemini-3.6-flash');
    expect(request.config).not.toHaveProperty('temperature');
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.systemInstruction).toContain('datos no confiables');
    expect(request.config.systemInstruction).toContain('discurso de odio');
    expect(request.config.systemInstruction).toContain('programacion');
    expect(request.config.systemInstruction).toContain(
      'cada afirmacion factual',
    );
    expect(request.config.safetySettings).toEqual([
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
    ]);
  });

  it('replaces a retired configured model with Gemini 3.6 Flash', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        claims: [
          {
            text: 'Respuesta',
            evidence: [{ sourceId: 'wiki:1', quote: 'Dato concreto' }],
          },
        ],
      }),
    });
    const adapter = new GeminiChatGenerationAdapter(
      config({ GEMINI_CHAT_MODEL: 'gemini-2.5-flash' }),
    );

    await expect(
      adapter.generate({
        question: 'Pregunta',
        history: [],
        sources: [
          { id: 'wiki:1', kind: 'wiki', label: 'Wiki', excerpt: 'Dato' },
        ],
      }),
    ).resolves.toMatchObject({ answer: 'Respuesta' });

    const requests = mockGenerateContent.mock.calls as Array<[GenerateRequest]>;
    expect(requests.map(([request]) => request.model)).toEqual([
      'gemini-3.6-flash',
    ]);
  });

  it('passes the request abort signal to Gemini', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          {
            text: 'Respuesta respaldada.',
            evidence: [{ sourceId: 'wiki:1', quote: 'Dato concreto' }],
          },
        ],
      }),
    });
    const adapter = new GeminiChatGenerationAdapter(config());
    const abortController = new AbortController();

    await adapter.generate({
      question: 'Pregunta',
      history: [],
      sources: [],
      signal: abortController.signal,
    });

    const requests = mockGenerateContent.mock.calls as Array<[GenerateRequest]>;
    expect(requests[0]?.[0].config.abortSignal).toBe(abortController.signal);
  });

  it('always appends the stable fallback even when a model list is configured', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('Missing'), { status: 404 }),
      )
      .mockResolvedValueOnce({
        text: JSON.stringify({
          claims: [{ text: 'OK', evidence: [] }],
        }),
      });
    const adapter = new GeminiChatGenerationAdapter(
      config({ GEMINI_CHAT_MODELS: 'custom-preview' }),
    );

    await adapter.generate({ question: 'Pregunta', history: [], sources: [] });

    const requests = mockGenerateContent.mock.calls as Array<[GenerateRequest]>;
    expect(requests.map(([request]) => request.model)).toEqual([
      'custom-preview',
      'gemini-3.6-flash',
    ]);
  });

  it('returns a sanitized service error instead of leaking provider details', async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error('secret upstream detail'), { status: 400 }),
    );
    const adapter = new GeminiChatGenerationAdapter(config());

    await expect(
      adapter.generate({ question: 'Pregunta', history: [], sources: [] }),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'El servicio de Chat IA no esta disponible temporalmente.',
      ),
    );
  });

  it('rejects a structurally invalid grounded response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          {
            text: '',
            evidence: [{ sourceId: 'wiki:1', quote: 'Dato concreto' }],
          },
        ],
      }),
    });
    const adapter = new GeminiChatGenerationAdapter(config());

    await expect(
      adapter.generate({ question: 'Pregunta', history: [], sources: [] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not call Gemini when no API key is configured', async () => {
    const adapter = new GeminiChatGenerationAdapter(config({}, false));

    await expect(
      adapter.generate({ question: 'Pregunta', history: [], sources: [] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

function config(
  values: Record<string, string> = {},
  includeApiKey = true,
): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key in values) {
        return values[key];
      }
      if (key === 'GEMINI_API_KEY' && includeApiKey) {
        return 'test-key';
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}
