const claimSchema = {
  type: 'object',
  properties: {
    entityName: { type: 'string' },
    field: { type: 'string' },
    value: { type: 'string' },
    chunkIndex: { type: 'integer', minimum: 0 },
    evidence: { type: 'string' },
  },
  required: ['entityName', 'field', 'value', 'chunkIndex', 'evidence'],
};

const contradictionSchema = {
  type: 'object',
  properties: {
    entityName: { type: 'string' },
    field: { type: 'string' },
    previousClaimIndex: { type: 'integer', minimum: 0 },
    currentChunkIndex: { type: 'integer', minimum: 0 },
    previousValue: { type: 'string' },
    currentValue: { type: 'string' },
    explanation: { type: 'string' },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
    currentEvidence: { type: 'string' },
  },
  required: [
    'entityName',
    'field',
    'previousClaimIndex',
    'currentChunkIndex',
    'previousValue',
    'currentValue',
    'explanation',
    'severity',
    'confidenceScore',
    'currentEvidence',
  ],
};

export const CONTINUITY_CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    claims: { type: 'array', items: claimSchema },
    contradictions: { type: 'array', items: contradictionSchema },
  },
  required: ['claims', 'contradictions'],
} as const;
