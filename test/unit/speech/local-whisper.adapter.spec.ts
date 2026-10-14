import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LocalWhisperSpeechToTextAdapter } from '../../../src/speech/adapters/local-whisper-speech-to-text.adapter';

describe('LocalWhisperSpeechToTextAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts the audio with configured language and trims the provider response', async () => {
    const config = createConfig({
      LOCAL_WHISPER_URL: '  http://whisper.local/  ',
      LOCAL_WHISPER_TIMEOUT_MS: '1200',
      LOCAL_WHISPER_LANGUAGE: '  es-MX  ',
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        providerResponse(200, '{"text":"  Una respuesta  ","language":" es "}'),
      );
    const adapter = new LocalWhisperSpeechToTextAdapter(config);

    await expect(
      adapter.transcribe({
        audio: Buffer.from('audio'),
        mimeType: 'audio/webm',
        filename: 'voice.webm',
      }),
    ).resolves.toEqual({ text: 'Una respuesta', language: ' es ' });

    const fetchCalls = fetch.mock.calls as Array<[string, RequestInit]>;
    expect(fetchCalls[0]?.[0]).toBe('http://whisper.local/transcribe');
    const form = fetchCalls[0]?.[1].body as FormData;
    expect(form.get('language')).toBe('es-MX');
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(fetchCalls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('uses default URL and language when optional configuration is absent', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(providerResponse(200, '{"text":"Idea"}'));
    const adapter = new LocalWhisperSpeechToTextAdapter(createConfig({}));

    await expect(
      adapter.transcribe({
        audio: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        filename: 'voice-note.webm',
      }),
    ).resolves.toEqual({ text: 'Idea' });

    const fetchCalls = fetch.mock.calls as Array<[string, RequestInit]>;
    expect(fetchCalls[0]?.[0]).toBe('http://127.0.0.1:8001/transcribe');
    const form = fetchCalls[0]?.[1].body as FormData;
    expect(form.get('language')).toBe('es');
    const audio = form.get('audio') as File;
    expect(audio.name).toBe('voice-note.webm');
  });

  it('maps each provider rejection status and preserves an unknown status message', async () => {
    const adapter = new LocalWhisperSpeechToTextAdapter(createConfig({}));
    const fetch = jest.spyOn(globalThis, 'fetch');
    const failures: Array<[number, string]> = [
      [413, 'El audio supera el límite permitido.'],
      [415, 'El archivo debe ser un audio válido.'],
      [422, 'No se detectó voz en el audio.'],
      [503, 'El servicio local de Whisper respondió con HTTP 503.'],
    ];

    for (const [status, message] of failures) {
      fetch.mockResolvedValueOnce(providerResponse(status, 'provider detail'));
      await expect(
        adapter.transcribe({
          audio: Buffer.from('audio'),
          mimeType: 'audio/webm',
          filename: 'voice.webm',
        }),
      ).rejects.toThrow(new ServiceUnavailableException(message));
    }
  });

  it('rejects empty, invalid JSON, and non-string transcription payloads', async () => {
    const adapter = new LocalWhisperSpeechToTextAdapter(createConfig({}));
    const fetch = jest.spyOn(globalThis, 'fetch');
    const input = {
      audio: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'voice.webm',
    };
    const message = new ServiceUnavailableException(
      'Whisper no pudo detectar texto en el audio.',
    );

    fetch.mockResolvedValueOnce(providerResponse(200, 'not-json'));
    await expect(adapter.transcribe(input)).rejects.toThrow(message);
    fetch.mockResolvedValueOnce(providerResponse(200, '{"text":42}'));
    await expect(adapter.transcribe(input)).rejects.toThrow(message);
  });

  it('converts network failures to a service unavailable error', async () => {
    const adapter = new LocalWhisperSpeechToTextAdapter(createConfig({}));
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      adapter.transcribe({
        audio: Buffer.from('audio'),
        mimeType: 'audio/webm',
        filename: 'voice.webm',
      }),
    ).rejects.toThrow(
      new ServiceUnavailableException(
        'El servicio local de Whisper no está disponible. Iniciá el servidor de transcripción local.',
      ),
    );
  });

  it('uses the default timeout for invalid and non-positive configuration', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(providerResponse(200, '{"text":"ok"}'));
    const adapter = new LocalWhisperSpeechToTextAdapter(
      createConfig({ LOCAL_WHISPER_TIMEOUT_MS: '-5' }),
    );

    await adapter.transcribe({
      audio: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'voice.webm',
    });

    const fetchCalls = fetch.mock.calls as Array<[string, RequestInit]>;
    expect(fetchCalls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});

function createConfig(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function providerResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response;
}
