import { GoogleGenAI } from '@google/genai';
import { AiProviderError } from '../ai-errors';
import type {
  EmbeddingTransport,
  EmbeddingTaskType,
  LlmJsonRequest,
  LlmTextResult,
  LlmTransport,
  ResolvedLlmStep,
} from '../ai.types';

/** Gemini API (Google AI Studio key). Used as the last resort of every chain. */
export class GeminiTransport implements LlmTransport, EmbeddingTransport {
  private readonly clients = new Map<string, GoogleGenAI>();

  async generate(
    step: ResolvedLlmStep,
    request: LlmJsonRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<LlmTextResult> {
    const response = await this.client(
      step.apiKey,
      options.timeoutMs,
    ).models.generateContent({
      model: step.model,
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      config: {
        systemInstruction: request.system,
        ...(request.gemini?.safetySettings
          ? { safetySettings: request.gemini.safetySettings }
          : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
        ...(request.temperature === undefined
          ? {}
          : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
        ...(request.gemini?.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: request.gemini.thinkingLevel } }
          : {}),
        abortSignal: options.signal,
      },
    });
    const text = response.text;
    if (!text) {
      throw new AiProviderError(undefined, 'Gemini API returned no content');
    }
    return {
      text,
      model: step.model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async embed(
    step: { model: string; apiKey: string },
    request: {
      texts: string[];
      dimensions: number;
      taskType?: EmbeddingTaskType;
    },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<number[][]> {
    const response = await this.client(
      step.apiKey,
      options.timeoutMs,
    ).models.embedContent({
      model: step.model,
      // One Content per text: a plain string[] is sent as a single content
      // with several parts and comes back as a single vector.
      contents: request.texts.map((text) => ({
        role: 'user',
        parts: [{ text }],
      })),
      config: {
        ...(request.taskType ? { taskType: request.taskType } : {}),
        outputDimensionality: request.dimensions,
        abortSignal: options.signal,
      },
    });
    return (response.embeddings ?? []).map(
      (embedding) => embedding.values ?? [],
    );
  }

  private client(apiKey: string, timeoutMs: number): GoogleGenAI {
    const cacheKey = `${apiKey}:${timeoutMs}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
      this.clients.set(cacheKey, client);
    }
    return client;
  }
}
