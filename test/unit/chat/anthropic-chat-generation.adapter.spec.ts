import type { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    beta: { messages: { create: mockCreate } },
  })),
}));

import { AnthropicChatGenerationAdapter } from '../../../src/chat/adapters/anthropic-chat-generation.adapter';

const input = {
  question: '¿Dónde aparece la cicatriz?',
  history: [],
  sources: [
    {
      id: 'manuscript:1',
      kind: 'manuscript' as const,
      label: 'Capítulo 1',
      excerpt: 'La cicatriz brilló.',
    },
  ],
};

function response(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          claims: [
            {
              text: 'La cicatriz aparece en el capítulo uno.',
              evidence: [
                { sourceId: 'manuscript:1', quote: 'La cicatriz brilló.' },
              ],
            },
          ],
        }),
      },
    ],
    usage: { input_tokens: 30, output_tokens: 8 },
    ...overrides,
  };
}

describe('AnthropicChatGenerationAdapter', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('uses the default model, structured output, effort, and fallbacks', async () => {
    mockCreate.mockResolvedValue(response());
    const adapter = new AnthropicChatGenerationAdapter(config());

    const result = await adapter.generate(input);

    expect(result).toEqual({
      answer: 'La cicatriz aparece en el capítulo uno.',
      sourceIds: ['manuscript:1'],
      claims: [
        {
          text: 'La cicatriz aparece en el capítulo uno.',
          evidence: [
            { sourceId: 'manuscript:1', quote: 'La cicatriz brilló.' },
          ],
        },
      ],
      inputTokens: 30,
      outputTokens: 8,
    });
    const [request] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: { additionalProperties: false },
        },
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(request['system']).toContain('Oraculo de PlumIA');
  });

  it('forwards the abort signal to the SDK', async () => {
    mockCreate.mockResolvedValue(response());
    const adapter = new AnthropicChatGenerationAdapter(config());
    const controller = new AbortController();

    await adapter.generate({ ...input, signal: controller.signal });

    const [, options] = mockCreate.mock.calls[0] as [unknown, unknown];
    expect(options).toEqual({ signal: controller.signal });
  });

  it('honors the configured model and effort', async () => {
    mockCreate.mockResolvedValue(response());
    const adapter = new AnthropicChatGenerationAdapter(
      config({
        ANTHROPIC_CHAT_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_CHAT_EFFORT: 'medium',
      }),
    );

    await adapter.generate(input);

    const [request] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(request).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'medium' },
    });
    expect(request).not.toHaveProperty('fallbacks');
  });

  it('maps refusals to a service unavailable error', async () => {
    mockCreate.mockResolvedValue(
      response({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    );
    const adapter = new AnthropicChatGenerationAdapter(config());

    await expect(adapter.generate(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed when no API key is configured', async () => {
    const adapter = new AnthropicChatGenerationAdapter(
      config({ ANTHROPIC_API_KEY: '' }),
    );

    await expect(adapter.generate(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

function config(values: Record<string, string> = {}): ConfigService {
  const merged: Record<string, string> = {
    ANTHROPIC_API_KEY: 'test-key',
    ...values,
  };
  return {
    get: jest.fn((key: string) => merged[key]),
  } as unknown as ConfigService;
}
