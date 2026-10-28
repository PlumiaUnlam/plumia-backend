import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { UserApiKeyService } from '../../user/user-api-key.service';
import { CROSS_CHUNK_INCONSISTENCY_PROMPT } from './prompts/cross-chunk-inconsistency.prompt';
import { CROSS_CHUNK_INCONSISTENCY_SCHEMA } from './prompts/cross-chunk-inconsistency.schema';
import { CONTINUITY_CHECKPOINT_PROMPT } from './prompts/continuity-checkpoint.prompt';
import { CONTINUITY_CHECKPOINT_SCHEMA } from './prompts/continuity-checkpoint.schema';
import { ENTITY_EXTRACTION_PROMPT } from './prompts/entity-extraction.prompt';
import { SCENE_GROUP_AUDIT_PROMPT } from './prompts/scene-group-audit.prompt';
import { SCENE_GROUP_AUDIT_SCHEMA } from './prompts/scene-group-audit.schema';
import type {
  ContinuityCheckpointClaim,
  ExtractedContinuityCheckpoint,
  ExtractedCrossChunkInconsistency,
  ExtractionResponse,
  TemporalAuditContext,
} from './entity-extraction.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_EFFORT = 'medium';
const ANTHROPIC_MAX_TOKENS = 16_000;
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const ANTHROPIC_FALLBACK_MODELS = new Set([
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
]);

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
          narrativeRelevance: { type: 'number', minimum: 0, maximum: 1 },
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
          'narrativeRelevance',
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
          sequenceKind: {
            type: 'string',
            enum: ['TRANSITION', 'CONTRADICTION', 'UNCERTAIN'],
          },
        },
        required: [
          'entityName',
          'attributeKey',
          'fromValue',
          'toValue',
          'confidenceScore',
          'evidence',
          'sequenceKind',
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
          confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'kind',
          'sourceEntity',
          'targetEntity',
          'relationType',
          'description',
          'intensity',
          'confidenceScore',
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
          relationship: {
            type: ['object', 'null'],
            properties: {
              sourceEntityName: { type: 'string' },
              targetEntityName: { type: 'string' },
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
            },
            required: ['sourceEntityName', 'targetEntityName', 'relationType'],
          },
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
          'relationship',
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
 * object and reject numeric bounds (`minimum`/`maximum`), so those are
 * dropped, and free-form `attributes` is sent as a list of key/value pairs
 * and folded back into a record after parsing.
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
    if (key === 'minimum' || key === 'maximum') {
      continue;
    }
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
const ANTHROPIC_CROSS_CHUNK_INCONSISTENCY_SCHEMA = toAnthropicSchema(
  CROSS_CHUNK_INCONSISTENCY_SCHEMA,
) as Record<string, unknown>;
const ANTHROPIC_SCENE_GROUP_AUDIT_SCHEMA = toAnthropicSchema(
  SCENE_GROUP_AUDIT_SCHEMA,
) as Record<string, unknown>;
const ANTHROPIC_CONTINUITY_CHECKPOINT_SCHEMA = toAnthropicSchema(
  CONTINUITY_CHECKPOINT_SCHEMA,
) as Record<string, unknown>;

/** Where a generation call goes: a Gemini client (server or user key) or Claude. */
type GenerationTarget =
  | { provider: 'gemini'; ai: GoogleGenAI; model: string }
  | { provider: 'anthropic'; ai: Anthropic; model: string };

@Injectable()
export class EntityExtractionClient {
  private readonly logger = new Logger(EntityExtractionClient.name);
  private readonly ai: GoogleGenAI;
  private readonly anthropicEffort: AnthropicEffort;
  private readonly embeddingModel: string;
  private readonly timeoutMs: number;
  constructor(
    private readonly config: ConfigService,
    private readonly userApiKeys: UserApiKeyService,
  ) {
    this.anthropicEffort = this.config
      .get<string>('ENTITY_EXTRACTION_EFFORT', DEFAULT_ANTHROPIC_EFFORT)
      .trim() as AnthropicEffort;
    const apiKey = this.config
      .get<string>('ENTITY_EXTRACTION_API_KEY', '')
      .trim();
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
      apiKey,
      httpOptions: { timeout: this.timeoutMs },
    });
  }

  /** User-specific models and keys are resolved for each queued scene. */
  hasExtractionModel(): boolean {
    return true;
  }

  hasEmbeddingModel(): boolean {
    return Boolean(this.embeddingModel);
  }

  async extractEntities(input: {
    userId?: string;
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
    const target = await this.getGenerationTarget(input.userId);
    this.logger.debug(
      `Running extraction with ${target.provider} model ${target.model}`,
    );

    const parsed = await this.generateJson<ExtractionResponse>(target, {
      systemPrompt: ENTITY_EXTRACTION_PROMPT,
      payload: JSON.stringify({
        sceneText: input.sceneText,
        knownEntities: input.knownEntities,
        ...(input.temporalContext
          ? { temporalContext: input.temporalContext }
          : {}),
      }),
      geminiSchema: EXTRACTION_RESPONSE_SCHEMA,
      anthropicSchema: ANTHROPIC_EXTRACTION_SCHEMA,
      label: 'Entity extraction',
    });
    this.foldAnthropicAttributes(parsed);

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

  async auditAdjacentChunks(input: {
    userId?: string;
    firstText: string;
    secondText: string;
    knownEntities: Array<{
      canonicalName: string;
      aliases: string[];
      type: string;
      description?: string | null;
      attributes?: Record<string, unknown>;
    }>;
    temporalContext?: TemporalAuditContext;
  }): Promise<ExtractedCrossChunkInconsistency[]> {
    const target = await this.getGenerationTarget(input.userId);
    const parsed = await this.generateJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(target, {
      systemPrompt: CROSS_CHUNK_INCONSISTENCY_PROMPT,
      payload: JSON.stringify({
        firstChunk: input.firstText,
        secondChunk: input.secondText,
        knownEntities: input.knownEntities,
        ...(input.temporalContext
          ? { temporalContext: input.temporalContext }
          : {}),
      }),
      geminiSchema: CROSS_CHUNK_INCONSISTENCY_SCHEMA,
      anthropicSchema: ANTHROPIC_CROSS_CHUNK_INCONSISTENCY_SCHEMA,
      label: 'Cross-chunk audit',
    });
    return Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  }

  async auditSceneChunkGroup(input: {
    userId?: string;
    chunks: Array<{ chunkIndex: number; text: string }>;
    knownEntities: Array<{
      canonicalName: string;
      aliases: string[];
      type: string;
      description?: string | null;
      attributes?: Record<string, unknown>;
    }>;
    temporalContext?: TemporalAuditContext;
  }): Promise<ExtractedCrossChunkInconsistency[]> {
    const target = await this.getGenerationTarget(input.userId);
    const parsed = await this.generateJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(target, {
      systemPrompt: SCENE_GROUP_AUDIT_PROMPT,
      payload: JSON.stringify({
        chunks: input.chunks,
        knownEntities: input.knownEntities,
        ...(input.temporalContext
          ? { temporalContext: input.temporalContext }
          : {}),
      }),
      geminiSchema: SCENE_GROUP_AUDIT_SCHEMA,
      anthropicSchema: ANTHROPIC_SCENE_GROUP_AUDIT_SCHEMA,
      label: 'Scene group audit',
    });
    return Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  }

  async auditSceneAgainstContinuityClaims(input: {
    userId?: string;
    chunks: Array<{ chunkIndex: number; text: string }>;
    previousClaims: ContinuityCheckpointClaim[];
    knownEntities: Array<{
      canonicalName: string;
      aliases: string[];
      type: string;
      description?: string | null;
      attributes?: Record<string, unknown>;
    }>;
    temporalContext?: TemporalAuditContext;
  }): Promise<ExtractedContinuityCheckpoint> {
    const target = await this.getGenerationTarget(input.userId);
    const parsed = await this.generateJson<ExtractedContinuityCheckpoint>(
      target,
      {
        systemPrompt: CONTINUITY_CHECKPOINT_PROMPT,
        payload: JSON.stringify({
          chunks: input.chunks,
          previousClaims: input.previousClaims,
          knownEntities: input.knownEntities,
          ...(input.temporalContext
            ? { temporalContext: input.temporalContext }
            : {}),
        }),
        geminiSchema: CONTINUITY_CHECKPOINT_SCHEMA,
        anthropicSchema: ANTHROPIC_CONTINUITY_CHECKPOINT_SCHEMA,
        label: 'Continuity checkpoint audit',
      },
    );
    return {
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      contradictions: Array.isArray(parsed.contradictions)
        ? parsed.contradictions
        : [],
    };
  }

  private async getGenerationTarget(
    userId?: string,
  ): Promise<GenerationTarget> {
    const configuration =
      await this.userApiKeys.getExtractionProviderConfiguration(userId);
    if (configuration.provider === 'anthropic') {
      return {
        provider: 'anthropic',
        ai: new Anthropic({
          apiKey: configuration.apiKey,
          timeout: this.timeoutMs,
        }),
        model: configuration.model,
      };
    }

    return {
      provider: 'gemini',
      ai: new GoogleGenAI({
        apiKey: configuration.apiKey,
        httpOptions: { timeout: this.timeoutMs },
      }),
      model: configuration.model,
    };
  }

  private async generateJson<T>(
    target: GenerationTarget,
    request: {
      systemPrompt: string;
      payload: string;
      geminiSchema: unknown;
      anthropicSchema: Record<string, unknown>;
      label: string;
    },
  ): Promise<T> {
    const content =
      target.provider === 'anthropic'
        ? await this.generateWithAnthropic(target.ai, target.model, request)
        : await this.generateWithGemini(target.ai, target.model, request);
    this.logger.debug(`${request.label} response: ${content}`);
    return this.safeParseJson<T>(content || '{}');
  }

  private async generateWithGemini(
    ai: GoogleGenAI,
    model: string,
    request: { systemPrompt: string; payload: string; geminiSchema: unknown },
  ): Promise<string> {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: request.payload }] }],
      config: {
        systemInstruction: request.systemPrompt,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: request.geminiSchema,
      },
    });
    return response.text ?? '{}';
  }

  private async generateWithAnthropic(
    ai: Anthropic,
    model: string,
    request: {
      systemPrompt: string;
      payload: string;
      anthropicSchema: Record<string, unknown>;
      label: string;
    },
  ): Promise<string> {
    const response = await ai.beta.messages.create({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.payload }],
      output_config: {
        effort: this.anthropicEffort,
        format: { type: 'json_schema', schema: request.anthropicSchema },
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
        `${request.label} refused by ${response.model} (${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`${request.label} response truncated (max_tokens)`);
    }

    return response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
  }

  /** Claude returns `attributes` as key/value pairs (see toAnthropicSchema). */
  private foldAnthropicAttributes(parsed: ExtractionResponse): void {
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
