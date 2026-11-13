import { AiProviderError } from '../../../src/ai/ai-errors';
import { OpenRouterTransport } from '../../../src/ai/transports/openrouter.transport';
import type { LlmJsonRequest } from '../../../src/ai/ai.types';

const step = {
  provider: 'openrouter' as const,
  model: 'openai/gpt-5.4-mini',
  apiKey: 'or-key',
  credential: 'server' as const,
};

const request: LlmJsonRequest = {
  schemaName: 'test',
  system: 'Sistema',
  user: 'Usuario',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      score: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['name'],
  },
  effort: 'max',
};

const options = { signal: new AbortController().signal, timeoutMs: 1_000 };

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('OpenRouterTransport', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('sends a closed, non-strict schema when some fields are optional', async () => {
    fetchMock.mockResolvedValue(
      reply({ choices: [{ message: { content: '{"name":"x"}' } }] }),
    );

    await new OpenRouterTransport().generate(step, request, options);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown> & {
      response_format: { json_schema: { strict: boolean; schema: unknown } };
    };
    expect(body.response_format.json_schema.strict).toBe(false);
    expect(JSON.stringify(body.response_format.json_schema.schema)).toContain(
      '"additionalProperties":false',
    );
    expect(
      JSON.stringify(body.response_format.json_schema.schema),
    ).not.toContain('minimum');
  });

  it('only sends parameters that every model accepts', async () => {
    fetchMock.mockResolvedValue(
      reply({ choices: [{ message: { content: '{"name":"x"}' } }] }),
    );

    await new OpenRouterTransport().generate(
      step,
      { ...request, temperature: 0, maxOutputTokens: 512 },
      options,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // require_parameters would drop every host of a model without them.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('reasoning');
    expect(body['provider']).toEqual({ require_parameters: true });
    expect(body['max_tokens']).toBe(4_096);
  });

  it('turns an error inside a 200 response into a provider error', async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { code: 429, message: 'Rate limit exceeded' } }),
    );

    await expect(
      new OpenRouterTransport().generate(step, request, options),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rejects a truncated answer', async () => {
    fetchMock.mockResolvedValue(
      reply({
        choices: [{ finish_reason: 'length', message: { content: '{"na' } }],
      }),
    );

    await expect(
      new OpenRouterTransport().generate(step, request, options),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it('keeps the HTTP status of failed requests', async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { message: 'Insufficient credits' } }, 402),
    );

    await expect(
      new OpenRouterTransport().generate(step, request, options),
    ).rejects.toMatchObject({
      status: 402,
      message: 'OpenRouter error 402: Insufficient credits',
    });
  });
});
