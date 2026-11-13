import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingRouter } from '../../ai/embedding-router.service';
import { LlmRouter } from '../../ai/llm-router.service';
import type { LlmStep } from '../../ai/ai.types';
import { UserApiKeyService } from '../../user/user-api-key.service';
import type { AiProvider } from '../../user/ai-provider-settings.types';
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
import {
  EXTRACTION_RESPONSE_SCHEMA,
  ANTHROPIC_EXTRACTION_SCHEMA,
  ANTHROPIC_CROSS_CHUNK_INCONSISTENCY_SCHEMA,
  ANTHROPIC_SCENE_GROUP_AUDIT_SCHEMA,
  ANTHROPIC_CONTINUITY_CHECKPOINT_SCHEMA,
} from './entity-extraction.schemas';

/**
 * Fallbacks with a user's own key stay on that key and provider: a personal
 * key must never silently switch to the server credentials.
 */
const USER_KEY_FALLBACK_MODELS: Record<AiProvider, string[]> = {
  gemini: [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
};

@Injectable()
export class EntityExtractionClient {
  private readonly logger = new Logger(EntityExtractionClient.name);
  private readonly router: LlmRouter;
  private readonly embeddings: EmbeddingRouter;
  private readonly embeddingEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly userApiKeys: UserApiKeyService,
    @Optional() router?: LlmRouter,
    @Optional() embeddings?: EmbeddingRouter,
  ) {
    this.router = router ?? new LlmRouter(config);
    this.embeddings = embeddings ?? new EmbeddingRouter(config);
    // Any non-empty value enables the similarity stage; vectors always come
    // from the embedding router (the indexed embedding model).
    this.embeddingEnabled = Boolean(
      this.config.get<string>('ENTITY_EXTRACTION_EMBEDDING_MODEL', '').trim(),
    );
  }

  /** User-specific models and keys are resolved for each queued scene. */
  hasExtractionModel(): boolean {
    return true;
  }

  hasEmbeddingModel(): boolean {
    return this.embeddingEnabled && this.embeddings.isConfigured();
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
    const parsed = await this.generateJson<ExtractionResponse>(input.userId, {
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
    const parsed = await this.generateJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(input.userId, {
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
    const parsed = await this.generateJson<{
      contradictions?: ExtractedCrossChunkInconsistency[];
    }>(input.userId, {
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
    const parsed = await this.generateJson<ExtractedContinuityCheckpoint>(
      input.userId,
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

  /**
   * The model the user (or the server) picked goes first. With a personal key
   * the fallbacks stay on that key; with server credentials the extraction
   * chain follows (Claude, OpenRouter, Gemini free tier).
   */
  private async generateJson<T>(
    userId: string | undefined,
    request: {
      systemPrompt: string;
      payload: string;
      geminiSchema: unknown;
      anthropicSchema: Record<string, unknown>;
      label: string;
    },
  ): Promise<T> {
    const configuration =
      await this.userApiKeys.getExtractionProviderConfiguration(userId);
    const isUserKey = configuration.credentialSource === 'USER';
    const selected: LlmStep = {
      provider: configuration.provider,
      model: configuration.model,
      apiKey: configuration.apiKey,
      credential: isUserKey ? 'user' : 'server',
    };
    const plan = isUserKey
      ? {
          steps: [
            selected,
            ...USER_KEY_FALLBACK_MODELS[configuration.provider].map(
              (model): LlmStep => ({ ...selected, model }),
            ),
          ],
        }
      : { leadingSteps: [selected] };

    const result = await this.router.generateJson<T>({
      useCase: 'extraction',
      request: {
        schemaName: request.label.toLowerCase().replace(/[^a-z0-9]+/gu, '_'),
        system: request.systemPrompt,
        user: request.payload,
        schema: request.geminiSchema as Record<string, unknown>,
        closedSchema: request.anthropicSchema,
        temperature: 0.1,
      },
      parse: (text) => {
        const value = JSON.parse(text) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError(`${request.label} returned invalid JSON`);
        }
        return value as T;
      },
      ...plan,
    });
    this.logger.debug(
      `${request.label} answered by ${result.provider}:${result.model}`,
    );
    return result.value;
  }

  /** Strict schemas return `attributes` as key/value pairs (see toAnthropicSchema). */
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
    if (!this.hasEmbeddingModel()) {
      return null;
    }
    const [embedding] = await this.embeddings.embed([text]);
    return embedding ?? null;
  }
}
