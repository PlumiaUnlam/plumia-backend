import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextResult,
} from '../ports/speech-to-text-provider.port';

const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8001';
const DEFAULT_TIMEOUT_MS = 90_000;

@Injectable()
export class LocalWhisperSpeechToTextAdapter implements SpeechToTextProvider {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly language: string;

  constructor(config: ConfigService) {
    this.url = (config.get<string>('LOCAL_WHISPER_URL') ?? DEFAULT_WHISPER_URL)
      .trim()
      .replace(/\/$/, '');
    this.timeoutMs = readPositiveNumber(
      config.get<string>('LOCAL_WHISPER_TIMEOUT_MS'),
      DEFAULT_TIMEOUT_MS,
    );
    this.language =
      config.get<string>('LOCAL_WHISPER_LANGUAGE')?.trim() ?? 'es';
  }

  async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    const form = new FormData();
    const audioBytes = new Uint8Array(input.audio.length);
    audioBytes.set(input.audio);
    form.append(
      'audio',
      new Blob([audioBytes.buffer], { type: input.mimeType }),
      input.filename,
    );
    form.append('language', input.language ?? this.language);

    let response: Response;
    try {
      response = await fetch(`${this.url}/transcribe`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        'El servicio local de Whisper no está disponible. Iniciá el servidor de transcripción local.',
      );
    }

    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = responseText ? (JSON.parse(responseText) as unknown) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = readStringProperty(payload, 'detail');
      throw new ServiceUnavailableException(
        providerMessage ??
          `El servicio local de Whisper respondió con HTTP ${response.status}.`,
      );
    }

    const text = readStringProperty(payload, 'text')?.trim();
    if (!text) {
      throw new ServiceUnavailableException(
        'Whisper no pudo detectar texto en el audio.',
      );
    }

    const language = readStringProperty(payload, 'language');
    return language ? { text, language } : { text };
  }
}

function readPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return undefined;
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}
