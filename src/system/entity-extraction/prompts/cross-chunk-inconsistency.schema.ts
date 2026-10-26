export const CROSS_CHUNK_INCONSISTENCY_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['TRANSITION', 'CONTRADICTION', 'UNCERTAIN'],
          },
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
          field: { type: 'string' },
          firstValue: { type: 'string' },
          secondValue: { type: 'string' },
          explanation: { type: 'string' },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
          firstEvidence: { type: 'array', items: { type: 'string' } },
          secondEvidence: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'kind',
          'entityName',
          'field',
          'firstValue',
          'secondValue',
          'explanation',
          'severity',
          'confidenceScore',
          'firstEvidence',
          'secondEvidence',
        ],
      },
    },
  },
  required: ['contradictions'],
} as const;
