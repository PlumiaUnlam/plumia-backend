import { ProposalStatus } from '@prisma/client';
import { type TemporalStateService } from '../../../src/knowledge/services/temporal-state.service';

export interface StateChangeInput {
  entityId: string;
  projectId: string;
  attributeKey: string;
  toValue: string;
  validFromSceneId: string;
  validToSceneId: string | null;
  source: string;
  positions: ReadonlyMap<string, number>;
}

export interface StateRecord {
  id: string;
  entityId: string;
  attributeKey: string;
  fromValue: string | null;
  toValue: string;
  validFromSceneId: string;
  validToSceneId: string | null;
  narrativeOrder: number | null;
  source: string;
  createdAt: Date;
}

export interface StateTransaction {
  chunk: { findFirst: jest.Mock; findMany: jest.Mock };
  entity: { findUnique: jest.Mock; update: jest.Mock };
  entityState: {
    create: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  entityStateProposal: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  outbox: { createMany: jest.Mock };
  scene: { findMany: jest.Mock };
  projectKnowledgeReviewSettings: { findUnique: jest.Mock };
}

export interface TransactionRunner {
  $transaction: jest.Mock;
}

export interface TemporalStateInternals {
  applyStateChange: (
    tx: StateTransaction,
    input: StateChangeInput & { narrativeOrder?: number },
  ) => Promise<unknown>;
  assertNoStandardOverlaps: (
    tx: StateTransaction,
    entityId: string,
    positions: ReadonlyMap<string, number>,
  ) => Promise<void>;
  assertWindow: (
    positions: ReadonlyMap<string, number>,
    fromSceneId: string,
    toSceneId: string | null | undefined,
  ) => void;
  enqueueTemporalAudit: (
    tx: StateTransaction,
    projectId: string,
    fromSceneId: string,
    positions: ReadonlyMap<string, number>,
  ) => Promise<void>;
  getOrderedScenes: (
    client: { scene: { findMany: jest.Mock } },
    projectId: string,
  ) => Promise<Array<{ id: string; title: string | null }>>;
  getScenePositions: (
    client: unknown,
    projectId: string,
  ) => Promise<Map<string, number>>;
  lockStateKey: (
    tx: StateTransaction,
    entityId: string,
    attributeKey: string,
  ) => Promise<void>;
}

export function setupTransaction(
  runner: TransactionRunner,
  tx: StateTransaction,
): void {
  runner.$transaction.mockImplementation(
    async (callback: (client: StateTransaction) => Promise<unknown>) =>
      callback(tx),
  );
}

export function stateTransaction(states: unknown[]): StateTransaction {
  return {
    chunk: { findFirst: jest.fn(), findMany: jest.fn() },
    entity: { findUnique: jest.fn(), update: jest.fn() },
    entityState: {
      findMany: jest.fn().mockResolvedValue(states),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      delete: jest.fn(),
    },
    entityStateProposal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    outbox: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    scene: { findMany: jest.fn() },
    projectKnowledgeReviewSettings: {
      findUnique: jest.fn().mockResolvedValue({ stateTrackingEnabled: true }),
    },
  };
}

export function stateProposalRecord(overrides: Record<string, unknown> = {}): {
  id: string;
  projectId: string;
  sceneId: string;
  entityId: string;
  attributeKey: string;
  fromValue: string;
  toValue: string;
  sourceChunkId: string;
  sourceChunkHash: string;
  conflictsWithLocked: boolean;
  narrativeOrder: number;
  sequenceKind: string;
  status: 'PENDING';
  createdAt: Date;
} {
  return {
    id: 'proposal-one',
    projectId: 'project-one',
    sceneId: 'scene-two',
    entityId: 'entity-one',
    attributeKey: 'location',
    fromValue: 'Port',
    toValue: 'Tower',
    sourceChunkId: 'chunk-one',
    sourceChunkHash: 'hash-one',
    conflictsWithLocked: false,
    narrativeOrder: 700,
    sequenceKind: 'TRANSITION',
    status: ProposalStatus.PENDING,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function state(
  id: string,
  attributeKey: string,
  toValue: string,
  validFromSceneId: string,
  validToSceneId: string | null,
  narrativeOrder: number | null = null,
): Pick<
  StateRecord,
  | 'id'
  | 'attributeKey'
  | 'toValue'
  | 'validFromSceneId'
  | 'validToSceneId'
  | 'narrativeOrder'
> {
  return {
    id,
    attributeKey,
    toValue,
    validFromSceneId,
    validToSceneId,
    narrativeOrder,
  };
}

export function stateRecord(overrides: Partial<StateRecord> = {}): StateRecord {
  return {
    id: 'state-one',
    entityId: 'entity-one',
    attributeKey: 'status',
    fromValue: 'alive',
    toValue: 'dead',
    validFromSceneId: 'scene-two',
    validToSceneId: null,
    narrativeOrder: null,
    source: 'author_manual',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function stateChange(
  overrides: Partial<StateChangeInput>,
): StateChangeInput {
  return {
    entityId: 'entity-one',
    projectId: 'project-one',
    attributeKey: 'location',
    toValue: 'Tower',
    validFromSceneId: 'scene-two',
    validToSceneId: null,
    source: 'author_manual',
    positions: new Map([
      ['scene-one', 0],
      ['scene-two', 1],
      ['scene-three', 2],
    ]),
    ...overrides,
  };
}

export function proposalInput(
  overrides: Partial<
    Parameters<TemporalStateService['createProposal']>[0]
  > = {},
): Parameters<TemporalStateService['createProposal']>[0] {
  return {
    projectId: 'project-one',
    sceneId: 'scene-two',
    sourceChunkId: 'chunk-one',
    sourceChunkHash: 'hash-one',
    entityId: 'entity-one',
    attributeKey: ' Location ',
    fromValue: 'Port',
    toValue: 'Tower',
    evidence: ['Elena llega a la torre.', 'Elena llega a la torre.'],
    confidenceScore: 0.92,
    ...overrides,
  };
}

export function proposalRecord(): {
  id: string;
  projectId: string;
  sceneId: string;
  sourceChunkId: null;
  sourceChunkHash: null;
  entityId: string;
  attributeKey: string;
  fromValue: string;
  toValue: string;
  evidence: string[];
  confidenceScore: number;
  conflictsWithLocked: boolean;
  status: 'PENDING';
  createdAt: Date;
} {
  return {
    id: 'proposal-one',
    projectId: 'project-one',
    sceneId: 'scene-two',
    sourceChunkId: null,
    sourceChunkHash: null,
    entityId: 'entity-one',
    attributeKey: 'status',
    fromValue: 'alive',
    toValue: 'dead',
    evidence: ['Elena llega a la torre.'],
    confidenceScore: 0.9,
    conflictsWithLocked: false,
    status: ProposalStatus.PENDING,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
