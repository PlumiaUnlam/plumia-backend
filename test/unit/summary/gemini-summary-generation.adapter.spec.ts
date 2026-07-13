import { type ConfigService } from '@nestjs/config';
import { GeminiSummaryGenerationAdapter } from '../../../src/summary/adapters/gemini-summary-generation.adapter';

describe('GeminiSummaryGenerationAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to the next configured model when the first model is unavailable', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Model unavailable' } }),
          {
            status: 404,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '{"summary":"Faithful"}' }] } },
            ],
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
          }),
          { status: 200 },
        ),
      );
    const adapter = new GeminiSummaryGenerationAdapter(config());

    const result = await adapter.generate({
      scope: 'scene',
      text: 'Eliana sees a blue light.',
      targetWords: 120,
    });

    expect(result).toMatchObject({
      content: 'Faithful',
      provider: 'gemini',
      model: 'gemini-second',
      inputTokens: 11,
      outputTokens: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      'gemini-first:generateContent',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      'gemini-second:generateContent',
    );
  });

  it('returns structured verifier violations', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        approved: false,
        violations: ['Remove the invented event.', ''],
      }),
    );
    const adapter = new GeminiSummaryGenerationAdapter(config());

    await expect(
      adapter.verify({
        scope: 'scene',
        sourceText: 'Eliana sees a light.',
        summary: 'Eliana finds a message.',
      }),
    ).resolves.toMatchObject({
      approved: false,
      violations: ['Remove the invented event.'],
      model: 'gemini-first',
    });
  });

  it('does not try a fallback for a non-recoverable API error', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Invalid request', { status: 400 }));
    const adapter = new GeminiSummaryGenerationAdapter(config());

    await expect(
      adapter.generate({ scope: 'scene', text: 'Text', targetWords: 120 }),
    ).rejects.toThrow('Gemini API error: 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
    }),
    { status: 200 },
  );
}

function config(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'GEMINI_API_KEY') {
        return 'test-key';
      }
      if (key === 'GEMINI_SUMMARY_MODELS') {
        return 'gemini-first,gemini-second';
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}
