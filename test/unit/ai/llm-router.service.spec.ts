import type { ConfigService } from '@nestjs/config';

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

import { GoogleGenAI } from '@google/genai';
import {
  AiChainExhaustedError,
  AiNotConfiguredError,
} from '../../../src/ai/ai-errors';
import { parseLlmChain } from '../../../src/ai/ai-chains.config';
import { LlmRouter } from '../../../src/ai/llm-router.service';
import type { LlmJsonRequest } from '../../../src/ai/ai.types';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

const request: LlmJsonRequest = {
  schemaName: 'test',
  system: 'Sistema',
  user: 'Usuario',
  schema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
};

const parse = (text: string): boolean => {
  const value = (JSON.parse(text) as { ok?: unknown }).ok;
  if (typeof value !== 'boolean') {
    throw new TypeError('invalid');
  }
  return value;
};

function geminiText(text: string): { text: string } {
  return { text };
}

describe('LlmRouter', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockAnthropicCreate.mockReset();
    jest.mocked(GoogleGenAI).mockClear();
  });

  it('parses chains keeping model ids that contain a colon', () => {
    expect(
      parseLlmChain(
        'anthropic:claude-x, openrouter:vendor/model:free, bogus:model, gemini:,gemini:g-1,gemini:g-1',
      ),
    ).toEqual([
      { provider: 'anthropic', model: 'claude-x' },
      { provider: 'openrouter', model: 'vendor/model:free' },
      { provider: 'gemini', model: 'g-1' },
    ]);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiText('```json\n{"ok":true}\n```'),
    );
    const router = new LlmRouter(
      config({ GEMINI_API_KEY: 'k', AI_SUMMARY_CHAIN: 'gemini:g-1' }),
    );

    await expect(
      router.generateJson({ useCase: 'summary', request, parse }),
    ).resolves.toMatchObject({ value: true, provider: 'gemini', model: 'g-1' });
  });

  it('throws a configuration error when no step has a key', async () => {
    const router = new LlmRouter(config({}));

    await expect(
      router.generateJson({ useCase: 'summary', request, parse }),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(router.hasConfiguredStep('summary')).toBe(false);
  });

  it('reports every failed step when the chain is exhausted', async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error('Quota'), { status: 429 }),
    );
    const router = new LlmRouter(
      config({
        GEMINI_API_KEY: 'k',
        AI_SUMMARY_CHAIN: 'gemini:g-1,gemini:g-2',
      }),
    );

    const error = await router
      .generateJson({ useCase: 'summary', request, parse })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiChainExhaustedError);
    expect((error as AiChainExhaustedError).failures).toEqual([
      'gemini:g-1: status=429 Quota',
      'gemini:g-2: status=429 Quota',
    ]);
  });

  it('opens the circuit of a model after repeated failures', async () => {
    mockGenerateContent.mockImplementation(({ model }: { model: string }) =>
      model === 'g-1'
        ? Promise.reject(Object.assign(new Error('down'), { status: 503 }))
        : Promise.resolve(geminiText('{"ok":true}')),
    );
    const router = new LlmRouter(
      config({
        GEMINI_API_KEY: 'k',
        AI_SUMMARY_CHAIN: 'gemini:g-1,gemini:g-2',
      }),
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await router.generateJson({ useCase: 'summary', request, parse });
    }

    const models = mockGenerateContent.mock.calls.map(
      ([call]: [{ model: string }]) => call.model,
    );
    // g-1 is tried three times, then skipped while its circuit is open.
    expect(models.filter((model) => model === 'g-1')).toHaveLength(3);
    expect(models.filter((model) => model === 'g-2')).toHaveLength(4);
  });

  it('skips every model of a key that has no credit', async () => {
    mockAnthropicCreate.mockRejectedValue(
      Object.assign(new Error('credit balance is too low'), { status: 402 }),
    );
    mockGenerateContent.mockResolvedValue(geminiText('{"ok":true}'));
    const router = new LlmRouter(
      config({
        ANTHROPIC_API_KEY: 'a',
        GEMINI_API_KEY: 'k',
        AI_SUMMARY_CHAIN: 'anthropic:c-1,anthropic:c-2,gemini:g-1',
      }),
    );

    await router.generateJson({ useCase: 'summary', request, parse });
    await router.generateJson({ useCase: 'summary', request, parse });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('never lets a broken user key open the circuit of the server key', async () => {
    mockGenerateContent.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('invalid key'), { status: 403 })),
    );
    const router = new LlmRouter(
      config({ GEMINI_API_KEY: 'server-key', AI_SUMMARY_CHAIN: 'gemini:g-1' }),
    );

    await expect(
      router.generateJson({
        useCase: 'summary',
        request,
        parse,
        steps: [{ provider: 'gemini', model: 'g-1', apiKey: 'user-key' }],
      }),
    ).rejects.toBeInstanceOf(AiChainExhaustedError);

    mockGenerateContent.mockResolvedValue(geminiText('{"ok":true}'));
    await expect(
      router.generateJson({ useCase: 'summary', request, parse }),
    ).resolves.toMatchObject({ value: true });
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'server-key' }),
    );
  });

  it('tries the leading steps first and removes duplicated steps', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
      .mockResolvedValueOnce(geminiText('{"ok":false}'));
    const router = new LlmRouter(
      config({
        GEMINI_API_KEY: 'k',
        AI_SUMMARY_CHAIN: 'gemini:g-1,gemini:g-2',
      }),
    );

    await expect(
      router.generateJson({
        useCase: 'summary',
        request,
        parse,
        leadingSteps: [{ provider: 'gemini', model: 'g-1' }],
      }),
    ).resolves.toMatchObject({ value: false, model: 'g-2' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('stops trying new steps once the time budget is spent', async () => {
    mockGenerateContent.mockImplementation(
      ({ config: callConfig }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          callConfig.abortSignal.addEventListener('abort', () =>
            reject(new Error('The operation was aborted')),
          );
        }),
    );
    const router = new LlmRouter(
      config({
        GEMINI_API_KEY: 'k',
        AI_SUMMARY_CHAIN: 'gemini:g-1,gemini:g-2,gemini:g-3',
        AI_SUMMARY_STEP_TIMEOUT_MS: '30',
        AI_SUMMARY_TOTAL_TIMEOUT_MS: '50',
      }),
    );

    const error = await router
      .generateJson({ useCase: 'summary', request, parse })
      .catch((caught: unknown) => caught);

    expect((error as AiChainExhaustedError).failures[0]).toBe(
      'gemini:g-1: timeout after 30ms',
    );
    expect(mockGenerateContent.mock.calls.length).toBeLessThan(3);
  });
});
