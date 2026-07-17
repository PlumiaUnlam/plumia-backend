import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { ENTITY_EXTRACTION_PROMPT } from './prompts/entity-extraction.prompt';
import type {
  ExtractionCandidate,
  ExtractionResponse,
} from './entity-extraction.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash';

const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          canonicalName: { type: 'string' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
          },
          type: {
            type: 'string',
            enum: [
              'CHARACTER',
              'LOCATION',
              'OBJECT',
              'ORGANIZATION',
              'EVENT',
              'CONCEPT',
            ],
          },
          description: { type: ['string', 'null'] },
          attributes: { type: 'object' },
          imageUrl: { type: ['string', 'null'] },
          confidenceScore: { type: 'number' },
          evidence: {
            type: 'array',
            items: { type: 'string' },
          },
          normalizedName: { type: 'string' },
        },
        required: ['canonicalName', 'aliases', 'type', 'description', 'attributes', 'imageUrl', 'confidenceScore', 'evidence', 'normalizedName'],
      },
    },
  },
  required: ['entities'],
} as const;

@Injectable()
export class EntityExtractionClient {
  private readonly logger = new Logger(EntityExtractionClient.name);
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embeddingModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ENTITY_EXTRACTION_API_KEY', '').trim();
    this.model = this.config.get<string>('ENTITY_EXTRACTION_MODEL', '').trim();
    this.embeddingModel = this.config
      .get<string>('ENTITY_EXTRACTION_EMBEDDING_MODEL', '')
      .trim();
    this.timeoutMs = Number(
      this.config.get<string>('ENTITY_EXTRACTION_TIMEOUT_MS', `${DEFAULT_TIMEOUT_MS}`),
    );

    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: this.timeoutMs },
    });
  }

  hasExtractionModel(): boolean {
    return Boolean(this.apiKey && this.model);
  }

  hasEmbeddingModel(): boolean {
    return Boolean(this.embeddingModel);
  }

  async extractEntities(input: {
    sceneText: string;
    knownEntities: Array<{
      canonicalName: string;
      aliases: string[];
      type: string;
    }>;
  }): Promise<ExtractionCandidate[]> {
    if (!this.hasExtractionModel()) {
      throw new Error(
        'ENTITY_EXTRACTION_API_KEY or ENTITY_EXTRACTION_MODEL is not configured',
      );
    }

    this.logger.debug(`Running extraction with model ${this.model || DEFAULT_CHAT_MODEL}`);

    const response = await this.ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify(input),
            },
          ],
        },
      ],
      config: {
        systemInstruction: ENTITY_EXTRACTION_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
    });

    const content = response.text ?? '{}';
    this.logger.debug(`Entity extraction response: ${content}`);

    const parsed = this.safeParseJson<ExtractionResponse>(content);
    return Array.isArray(parsed.entities) ? parsed.entities : [];
  }

  async createEmbedding(text: string): Promise<number[] | null> {
    if (!this.embeddingModel) {
      return null;
    }

    this.logger.debug(`Running embeddings with model ${this.embeddingModel}`);

    const response = await this.ai.models.embedContent({
      model: this.embeddingModel,
      contents: text,
    });

    return response.embeddings?.[0]?.values ?? null;
  }

  private safeParseJson<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      const match = value.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }

      throw new Error('Entity extraction returned invalid JSON');
    }
  }
}
