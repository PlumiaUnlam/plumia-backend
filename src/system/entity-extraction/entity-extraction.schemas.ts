import { CROSS_CHUNK_INCONSISTENCY_SCHEMA } from './prompts/cross-chunk-inconsistency.schema';
import { CONTINUITY_CHECKPOINT_SCHEMA } from './prompts/continuity-checkpoint.schema';
import { SCENE_GROUP_AUDIT_SCHEMA } from './prompts/scene-group-audit.schema';

export const EXTRACTION_RESPONSE_SCHEMA = {
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
  const type = result['type'];
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    result['additionalProperties'] = false;
  }
  return result;
}

export const ANTHROPIC_EXTRACTION_SCHEMA = toAnthropicSchema(
  EXTRACTION_RESPONSE_SCHEMA,
) as Record<string, unknown>;

export const ANTHROPIC_CROSS_CHUNK_INCONSISTENCY_SCHEMA = toAnthropicSchema(
  CROSS_CHUNK_INCONSISTENCY_SCHEMA,
) as Record<string, unknown>;

export const ANTHROPIC_SCENE_GROUP_AUDIT_SCHEMA = toAnthropicSchema(
  SCENE_GROUP_AUDIT_SCHEMA,
) as Record<string, unknown>;

export const ANTHROPIC_CONTINUITY_CHECKPOINT_SCHEMA = toAnthropicSchema(
  CONTINUITY_CHECKPOINT_SCHEMA,
) as Record<string, unknown>;
