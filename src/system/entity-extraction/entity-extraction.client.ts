import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { ENTITY_EXTRACTION_PROMPT } from './prompts/entity-extraction.prompt';
import type {
  ExtractionResponse,
  TemporalAuditContext,
} from './entity-extraction.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
const DEFAULT_ANTHROPIC_EFFORT = 'medium';
const ANTHROPIC_MAX_TOKENS = 16_000;
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const ANTHROPIC_FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
]);

type ExtractionProvider = 'gemini' | 'anthropic';
type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
        required: [
          'canonicalName',
          'aliases',
          'type',
          'description',
          'attributes',
          'imageUrl',
          'confidenceScore',
          'evidence',
          'normalizedName',
        ],
      },
    },
    stateChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityName: { type: 'string' },
          attributeKey: { type: 'string' },
          fromValue: { type: ['string', 'null'] },
          toValue: { type: 'string' },
          confidenceScore: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'entityName',
          'attributeKey',
          'fromValue',
          'toValue',
          'confidenceScore',
          'evidence',
        ],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['CREATE', 'UPDATE', 'END'] },
          sourceEntity: { type: 'string' },
          targetEntity: { type: 'string' },
          relationType: {
            type: 'string',
            enum: [
              'ALLY',
              'ENEMY',
              'FAMILY',
              'ROMANTIC',
              'MENTOR',
              'RIVAL',
              'MEMBER_OF',
              'LOCATED_IN',
              'OWNS',
              'KNOWS',
            ],
          },
          description: { type: ['string', 'null'] },
          intensity: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'kind',
          'sourceEntity',
          'targetEntity',
          'relationType',
          'description',
          'intensity',
          'evidence',
        ],
      },
    },
    inconsistencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityName: { type: 'string' },
          ruleCode: {
            type: 'string',
            enum: [
              'ENTITY_CONTRADICTION',
              'DEAD_CHARACTER_ACTION',
              'WORLDBUILDING_RULE',
            ],
          },
          field: { type: 'string' },
          currentValue: { type: 'string' },
          observedValue: { type: 'string' },
          explanation: { type: 'string' },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          confidenceScore: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'entityName',
          'ruleCode',
          'field',
          'currentValue',
          'observedValue',
          'explanation',
          'severity',
          'confidenceScore',
          'evidence',
        ],
      },
    },
  },
  required: ['entities', 'stateChanges', 'relationships', 'inconsistencies'],
} as const;

/**
 * Claude structured outputs require `additionalProperties: false` on every
 * object, so free-form `attributes` is sent as a list of key/value pairs and
 * folded back into a record after parsing.
 */
function toAnthropicSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(toAnthropicSchema);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    result[key] = toAnthropicSchema(value);
  }

  const properties = result['properties'] as
    | Record<string, unknown>
    | undefined;
  if (properties && 'attributes' in properties) {
    properties['attributes'] = {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    };
  }
  if (result['type'] === 'object') {
    result['additionalProperties'] = false;
  }
  return result;
}

const ANTHROPIC_EXTRACTION_SCHEMA = toAnthropicSchema(
  EXTRACTION_RESPONSE_SCHEMA,
) as Record<string, unknown>;

@Injectable()
export class EntityExtractionClient {
  private readonly logger = new Logger(EntityExtractionClient.name);
  private readonly ai: GoogleGenAI;
  private readonly anthropic: Anthropic;
  private readonly provider: ExtractionProvider;
  private readonly apiKey: string;
  private readonly anthropicApiKey: string;
  private readonly anthropicEffort: AnthropicEffort;
  private readonly model: string;
  private readonly embeddingModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.provider =
      this.config
        .get<string>('ENTITY_EXTRACTION_PROVIDER', 'gemini')
        .trim()
        .toLowerCase() === 'anthropic'
        ? 'anthropic'
        : 'gemini';
    this.anthropicApiKey = this.config
      .get<string>('ANTHROPIC_API_KEY', '')
      .trim();
    this.anthropicEffort = this.config
      .get<string>('ENTITY_EXTRACTION_EFFORT', DEFAULT_ANTHROPIC_EFFORT)
      .trim() as AnthropicEffort;
    this.apiKey = this.config
      .get<string>('ENTITY_EXTRACTION_API_KEY', '')
      .trim();
    this.model = this.config.get<string>('ENTITY_EXTRACTION_MODEL', '').trim();
    this.embeddingModel = this.config
      .get<string>('ENTITY_EXTRACTION_EMBEDDING_MODEL', '')
      .trim();
    this.timeoutMs = Number(
      this.config.get<string>(
        'ENTITY_EXTRACTION_TIMEOUT_MS',
        `${DEFAULT_TIMEOUT_MS}`,
      ),
    );

    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: this.timeoutMs },
    });
    this.anthropic = new Anthropic({
      apiKey: this.anthropicApiKey || null,
      timeout: this.timeoutMs,
    });
  }

  hasExtractionModel(): boolean {
    if (this.provider === 'anthropic') {
      return Boolean(this.anthropicApiKey);
    }
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
      description?: string | null;
      attributes?: Record<string, unknown>;
    }>;
    temporalContext?: TemporalAuditContext;
  }): Promise<ExtractionResponse> {
    if (!this.hasExtractionModel()) {
      throw new Error(
        this.provider === 'anthropic'
          ? 'ANTHROPIC_API_KEY is not configured'
          : 'ENTITY_EXTRACTION_API_KEY or ENTITY_EXTRACTION_MODEL is not configured',
      );
    }

    const payload = JSON.stringify({
      sceneText: input.sceneText,
      knownEntities: input.knownEntities,
      ...(input.temporalContext
        ? { temporalContext: input.temporalContext }
        : {}),
    });

    const parsed =
      this.provider === 'anthropic'
        ? await this.extractWithAnthropic(payload)
        : await this.extractWithGemini(payload);

    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      stateChanges: Array.isArray(parsed.stateChanges)
        ? parsed.stateChanges
        : [],
      relationships: Array.isArray(parsed.relationships)
        ? parsed.relationships
        : [],
      inconsistencies: Array.isArray(parsed.inconsistencies)
        ? parsed.inconsistencies
        : [],
    };
  }

  private async extractWithGemini(
    payload: string,
  ): Promise<ExtractionResponse> {
    this.logger.debug(
      `Running extraction with model ${this.model || DEFAULT_CHAT_MODEL}`,
    );

    const response = await this.ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [{ role: 'user', parts: [{ text: payload }] }],
      config: {
        systemInstruction: ENTITY_EXTRACTION_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
    });

    const content = response.text ?? '{}';
    this.logger.debug(`Entity extraction response: ${content}`);

    return this.safeParseJson<ExtractionResponse>(content);
  }

  private async extractWithAnthropic(
    payload: string,
  ): Promise<ExtractionResponse> {
    const model = this.model || DEFAULT_ANTHROPIC_MODEL;
    this.logger.debug(`Running extraction with model ${model}`);

    const response = await this.anthropic.beta.messages.create({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: ENTITY_EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: payload }],
      output_config: {
        effort: this.anthropicEffort,
        format: { type: 'json_schema', schema: ANTHROPIC_EXTRACTION_SCHEMA },
      },
      ...(ANTHROPIC_FALLBACK_MODELS.has(model)
        ? {
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default' as const,
          }
        : {}),
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Entity extraction refused by ${response.model} (${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Entity extraction response truncated (max_tokens)');
    }

    const content = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    this.logger.debug(`Entity extraction response: ${content}`);

    const parsed = this.safeParseJson<ExtractionResponse>(content || '{}');
    for (const entity of parsed.entities ?? []) {
      const pairs = entity.attributes as unknown;
      if (Array.isArray(pairs)) {
        entity.attributes = Object.fromEntries(
          (pairs as Array<{ key: string; value: string }>).map((pair) => [
            pair.key,
            pair.value,
          ]),
        );
      }
    }
    return parsed;
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
      const start = value.indexOf('{');
      const end = value.lastIndexOf('}');
      if (start !== -1 && end > start) {
        return JSON.parse(value.slice(start, end + 1)) as T;
      }

      throw new Error('Entity extraction returned invalid JSON');
    }
  }
}
