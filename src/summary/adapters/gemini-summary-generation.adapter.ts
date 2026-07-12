import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { estimateTokens } from '../domain/text-content';
import type {
  SummaryGenerationInput,
  SummaryGenerationProvider,
  SummaryGenerationResult,
} from '../ports/summary-generation-provider.port';

const TIMEOUT_MS = 90_000;

@Injectable()
export class GeminiSummaryGenerationAdapter implements SummaryGenerationProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') ?? '';
    this.model =
      config.get<string>('GEMINI_SUMMARY_MODEL') ?? 'gemini-flash-latest';
  }

  async generate(
    input: SummaryGenerationInput,
  ): Promise<SummaryGenerationResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('GEMINI_API_KEY is not configured');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'Eres un editor narrativo riguroso. No inventes hechos y responde solamente JSON valido.',
                },
              ],
            },
            contents: [{ parts: [{ text: buildPrompt(input) }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: { summary: { type: 'STRING' } },
                required: ['summary'],
              },
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }
      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini API returned no content');
      }
      const parsed = JSON.parse(text) as { summary?: unknown };
      if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
        throw new Error('Gemini API returned invalid summary');
      }
      return {
        content: parsed.summary.trim(),
        inputTokens:
          payload.usageMetadata?.promptTokenCount ?? estimateTokens(input.text),
        outputTokens:
          payload.usageMetadata?.candidatesTokenCount ??
          estimateTokens(parsed.summary),
        provider: 'gemini',
        model: this.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildPrompt(input: SummaryGenerationInput): string {
  return `Resume el siguiente ${input.scope} de ficción en español. Conserva eventos, relaciones de causalidad, cambios de personaje, conflictos abiertos y consecuencias. No agregues interpretaciones ni datos ausentes. Produce una síntesis narrativa clara de aproximadamente ${input.targetWords} palabras, sin exceder ese objetivo en más de 15%.\n\nTEXTO:\n${input.text}`;
}
