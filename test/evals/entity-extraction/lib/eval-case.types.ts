import type {
  ExtractionResponse,
  TemporalAuditContext,
} from '../../../../src/system/entity-extraction/entity-extraction.types';

export type Section =
  | 'entities'
  | 'relationships'
  | 'stateChanges'
  | 'inconsistencies';

export const SECTIONS: Section[] = [
  'entities',
  'relationships',
  'stateChanges',
  'inconsistencies',
];

export interface ExtractionInput {
  sceneText: string;
  knownEntities: Array<{
    canonicalName: string;
    aliases: string[];
    type: string;
    description?: string | null;
    attributes?: Record<string, unknown>;
  }>;
  temporalContext?: TemporalAuditContext;
}

export interface EntityMatcher {
  name: string;
  type?: string;
  /** Aliases that must appear among the returned aliases. */
  aliasesInclude?: string[];
  /** Match only against canonicalName, ignoring aliases. */
  canonicalOnly?: boolean;
}

export interface RelationshipMatcher {
  source: string;
  target: string;
  type?: string;
  kind?: 'CREATE' | 'UPDATE' | 'END';
  /** Accept source/target swapped (symmetric relations such as KNOWS). */
  anyDirection?: boolean;
}

export interface StateChangeMatcher {
  entity: string;
  key?: string;
  /** Passes when the normalized toValue contains any of these. */
  toValue?: string[];
}

export interface InconsistencyMatcher {
  entity: string;
  ruleCode?:
    | 'ENTITY_CONTRADICTION'
    | 'DEAD_CHARACTER_ACTION'
    | 'WORLDBUILDING_RULE';
}

export interface SectionExpectation<M> {
  /** Items the model must return. */
  mustInclude?: M[];
  /** Items the model must never return. */
  mustNotInclude?: M[];
  /** With `exhaustive`, extra items tolerated beyond `mustInclude`. */
  allow?: M[];
  /** Any item not covered by `mustInclude`/`allow` fails the case. */
  exhaustive?: boolean;
}

export interface CaseExpectations {
  entities?: SectionExpectation<EntityMatcher>;
  relationships?: SectionExpectation<RelationshipMatcher>;
  stateChanges?: SectionExpectation<StateChangeMatcher>;
  inconsistencies?: SectionExpectation<InconsistencyMatcher>;
}

export interface EvalCase {
  id: string;
  description: string;
  tags: string[];
  input: ExtractionInput;
  expect: CaseExpectations;
}

export interface ExpectationResult {
  section: Section;
  kind: 'mustInclude' | 'mustNotInclude' | 'unexpected';
  label: string;
  passed: boolean;
}

export type InvariantCode =
  | 'evidence_present'
  | 'evidence_grounded'
  | 'canonical_names'
  | 'references_resolvable'
  | 'aliases_in_text'
  | 'no_generic_objects'
  | 'scores_in_range';

export interface InvariantResult {
  code: InvariantCode;
  checked: number;
  violations: string[];
}

export interface SectionStats {
  expected: number;
  hit: number;
  forbidden: number;
  forbiddenHit: number;
  /** Only counted for exhaustive sections, where precision is meaningful. */
  produced: number;
  unexpected: number;
}

export interface RunEvaluation {
  passed: boolean;
  expectations: ExpectationResult[];
  invariants: InvariantResult[];
  sections: Record<Section, SectionStats>;
}

export interface RunRecord {
  ok: boolean;
  latencyMs: number;
  error?: string;
  output?: ExtractionResponse;
  evaluation?: RunEvaluation;
}

export interface CaseResult {
  id: string;
  tags: string[];
  passRate: number;
  runs: RunRecord[];
}

export interface Ratio {
  num: number;
  den: number;
  rate: number | null;
}

export interface EvalSummary {
  cases: number;
  runsPerCase: number;
  meanPassRate: number;
  fullyPassingCases: number;
  flakyCases: number;
  errors: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  sections: Record<
    Section,
    { recall: Ratio; forbiddenRate: Ratio; precision: Ratio }
  >;
  invariants: Record<InvariantCode, Ratio>;
}

export interface EvalMeta {
  startedAt: string;
  promptHash: string;
  provider: string;
  model: string;
  effort: string | null;
  runs: number;
  filter: string | null;
  gitCommit: string | null;
  gitDirty: boolean | null;
}

export interface EvalResultFile {
  meta: EvalMeta;
  summary: EvalSummary;
  cases: CaseResult[];
}
