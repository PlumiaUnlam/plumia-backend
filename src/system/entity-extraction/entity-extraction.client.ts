import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
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

@Injectable()
export class EntityExtractionClient {
  private readonly logger = new Logger(EntityExtractionClient.name);
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embeddingModel: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly userApiKeys: UserApiKeyService,
  ) {
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
  }

  hasExtractionModel(): boolean {
    return Boolean(this.model);
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
    const ai = await this.getGenerationClient(input.userId);
    if (!this.model || !ai) {
      throw new Error(
        'No extraction API key is configured for this user or the server',
      );
    }

    this.logger.debug(
      `Running extraction with model ${this.model || DEFAULT_CHAT_MODEL}`,
    );

    const response = await ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                sceneText: input.sceneText,
                knownEntities: input.knownEntities,
                ...(input.temporalContext
                  ? { temporalContext: input.temporalContext }
                  : {}),
              }),
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
    const ai = await this.getGenerationClient(input.userId);
    if (!this.model || !ai) {
      throw new Error(
        'No extraction API key is configured for this user or the server',
      );
    }

    const response = await ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                firstChunk: input.firstText,
                secondChunk: input.secondText,
                knownEntities: input.knownEntities,
                ...(input.temporalContext
                  ? { temporalContext: input.temporalContext }
                  : {}),
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: CROSS_CHUNK_INCONSISTENCY_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: CROSS_CHUNK_INCONSISTENCY_SCHEMA,
      },
    });

    const parsed = this.safeParseJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(response.text ?? '{}');
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
    const ai = await this.getGenerationClient(input.userId);
    if (!this.model || !ai) {
      throw new Error(
        'No extraction API key is configured for this user or the server',
      );
    }
    const response = await ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                chunks: input.chunks,
                knownEntities: input.knownEntities,
                ...(input.temporalContext
                  ? { temporalContext: input.temporalContext }
                  : {}),
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: SCENE_GROUP_AUDIT_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: SCENE_GROUP_AUDIT_SCHEMA,
      },
    });
    const parsed = this.safeParseJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(response.text ?? '{}');
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
    const ai = await this.getGenerationClient(input.userId);
    if (!this.model || !ai) {
      throw new Error(
        'No extraction API key is configured for this user or the server',
      );
    }
    const response = await ai.models.generateContent({
      model: this.model || DEFAULT_CHAT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                chunks: input.chunks,
                previousClaims: input.previousClaims,
                knownEntities: input.knownEntities,
                ...(input.temporalContext
                  ? { temporalContext: input.temporalContext }
                  : {}),
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: CONTINUITY_CHECKPOINT_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: CONTINUITY_CHECKPOINT_SCHEMA,
      },
    });
    const parsed = this.safeParseJson<ExtractedContinuityCheckpoint>(
      response.text ?? '{}',
    );
    return {
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      contradictions: Array.isArray(parsed.contradictions)
        ? parsed.contradictions
        : [],
    };
  }

  private async getGenerationClient(
    userId?: string,
  ): Promise<GoogleGenAI | null> {
    const userApiKey = userId
      ? await this.userApiKeys.getActiveGeminiKey(userId)
      : null;
    if (userApiKey) {
      return new GoogleGenAI({
        apiKey: userApiKey,
        httpOptions: { timeout: this.timeoutMs },
      });
    }
    return this.apiKey ? this.ai : null;
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
