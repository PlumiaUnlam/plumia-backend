import type { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

const mockGenerateContent = jest.fn();
const mockAnthropicCreate = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    beta: { messages: { create: mockAnthropicCreate } },
  })),
}));

import { LlmRouter } from '../../../src/ai/llm-router.service';
import { AiSummaryGenerationAdapter } from '../../../src/summary/adapters/ai-summary-generation.adapter';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function adapter(values: Record<string, string>): AiSummaryGenerationAdapter {
  return new AiSummaryGenerationAdapter(new LlmRouter(config(values)));
}

describe('AiSummaryGenerationAdapter', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockAnthropicCreate.mockReset();
  });

  it('summarizes with Claude first and records who answered', async () => {
    mockAnthropicCreate.mockResolvedValue({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"summary":" Fiel "}' }],
      usage: { input_tokens: 11, output_tokens: 4 },
    });

    await expect(
      adapter({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).generate({
        scope: 'scene',
        text: 'Eliana ve una luz azul.',
        targetWords: 120,
      }),
    ).resolves.toEqual({
      content: 'Fiel',
      inputTokens: 11,
      outputTokens: 4,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    });
    const [request] = mockAnthropicCreate.mock.calls[0] as [
      { system: string; messages: Array<{ content: string }> },
    ];
    expect(request.system).toContain('meticulous literary editor');
    expect(request.messages[0]?.content).toContain('Eliana ve una luz azul.');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('falls back to the next Gemini model when the first one is unavailable', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('Missing'), { status: 404 }),
      )
      .mockResolvedValueOnce({
        text: '{"summary":"Faithful"}',
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
      });

    const result = await adapter({ GEMINI_API_KEY: 'g' }).generate({
      scope: 'chapter',
      text: 'Texto',
      targetWords: 200,
      revisionInstructions: 'Quitá el evento inventado.',
    });

    expect(result).toMatchObject({
      content: 'Faithful',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    });
    const models = mockGenerateContent.mock.calls.map(
      ([call]: [{ model: string }]) => call.model,
    );
    expect(models).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
    const [first] = mockGenerateContent.mock.calls[0] as [
      { contents: Array<{ parts: Array<{ text: string }> }> },
    ];
    expect(first.contents[0]?.parts[0]?.text).toContain('Required Corrections');
  });

  it('returns structured verifier violations', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        approved: false,
        violations: ['Remove the invented event.', ''],
      }),
    });

    await expect(
      adapter({ GEMINI_API_KEY: 'g' }).verify({
        scope: 'scene',
        sourceText: 'Eliana sees a light.',
        summary: 'Eliana finds a message.',
      }),
    ).resolves.toMatchObject({
      approved: false,
      violations: ['Remove the invented event.'],
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('treats an empty summary as a failure of that provider', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: '{"summary":"   "}' })
      .mockResolvedValueOnce({ text: '{"summary":"Segunda"}' });

    await expect(
      adapter({ GEMINI_API_KEY: 'g' }).generate({
        scope: 'scene',
        text: 'Texto',
        targetWords: 80,
      }),
    ).resolves.toMatchObject({ content: 'Segunda' });
  });

  it('reports a missing configuration', async () => {
    await expect(
      adapter({}).generate({ scope: 'scene', text: 'Texto', targetWords: 80 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
