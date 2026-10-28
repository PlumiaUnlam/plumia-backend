import { EntityResolutionService } from '../../../../src/system/entity-extraction/entity-resolution.service';
import type {
  ExtractedInconsistency,
  ExtractedRelationship,
  ExtractedStateChange,
  ExtractionCandidate,
  ExtractionResponse,
} from '../../../../src/system/entity-extraction/entity-extraction.types';
import type {
  EntityMatcher,
  EvalCase,
  ExpectationResult,
  InconsistencyMatcher,
  InvariantCode,
  InvariantResult,
  RelationshipMatcher,
  RunEvaluation,
  Section,
  SectionExpectation,
  SectionStats,
  StateChangeMatcher,
} from './eval-case.types';

// Same normalization the pipeline uses to match names, so the eval compares
// labels exactly like production does.
const resolution = new EntityResolutionService();
export const normalize = (value: string | null | undefined): string =>
  resolution.normalize(value ?? '');

// Mirrors the generic-object list in the prompt.
const GENERIC_OBJECTS = new Set(
  [
    'puerta',
    'mesa',
    'silla',
    'ventana',
    'vaso',
    'cuchillo',
    'libro',
    'taza',
    'cama',
    'pared',
    'techo',
    'calle',
    'casa',
    'arbol',
    'roca',
    'lampara',
    'vestido',
    'arma',
    'herramienta',
  ].map(normalize),
);
const LEADING_ARTICLE = /^(el|la|los|las|un|una|unos|unas) /;

type Matcher<T, M> = (item: T, matcher: M) => boolean;

function labelsOf(entity: ExtractionCandidate): string[] {
  return [entity.canonicalName, ...(entity.aliases ?? [])].map(normalize);
}

const matchEntity: Matcher<ExtractionCandidate, EntityMatcher> = (
  entity,
  matcher,
) => {
  const labels = matcher.canonicalOnly
    ? [normalize(entity.canonicalName)]
    : labelsOf(entity);
  if (!labels.includes(normalize(matcher.name))) {
    return false;
  }
  if (matcher.type && String(entity.type) !== matcher.type) {
    return false;
  }
  // "el Tuerto" and "Tuerto" count as the same alias.
  const bare = (value: string): string =>
    normalize(value).replace(LEADING_ARTICLE, '');
  const aliases = (entity.aliases ?? []).map(bare);
  return (matcher.aliasesInclude ?? []).every((alias) =>
    aliases.includes(bare(alias)),
  );
};

const matchRelationship: Matcher<ExtractedRelationship, RelationshipMatcher> = (
  relationship,
  matcher,
) => {
  const source = normalize(relationship.sourceEntity);
  const target = normalize(relationship.targetEntity);
  const expectedSource = normalize(matcher.source);
  const expectedTarget = normalize(matcher.target);
  const sameDirection = source === expectedSource && target === expectedTarget;
  const swapped = source === expectedTarget && target === expectedSource;
  if (!sameDirection && !(matcher.anyDirection && swapped)) {
    return false;
  }
  if (matcher.type && String(relationship.relationType) !== matcher.type) {
    return false;
  }
  return !matcher.kind || relationship.kind === matcher.kind;
};

const matchStateChange: Matcher<ExtractedStateChange, StateChangeMatcher> = (
  change,
  matcher,
) => {
  if (normalize(change.entityName) !== normalize(matcher.entity)) {
    return false;
  }
  if (
    matcher.key &&
    normalize(change.attributeKey) !== normalize(matcher.key)
  ) {
    return false;
  }
  const toValue = normalize(change.toValue);
  return (
    !matcher.toValue ||
    matcher.toValue.some((value) => toValue.includes(normalize(value)))
  );
};

const matchInconsistency: Matcher<
  ExtractedInconsistency,
  InconsistencyMatcher
> = (inconsistency, matcher) =>
  normalize(inconsistency.entityName) === normalize(matcher.entity) &&
  (!matcher.ruleCode || inconsistency.ruleCode === matcher.ruleCode);

function describeMatcher(matcher: object): string {
  return Object.entries(matcher)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
}

function describeItem(section: Section, item: unknown): string {
  const value = item as Record<string, unknown>;
  switch (section) {
    case 'entities':
      return `${String(value['canonicalName'])} (${String(value['type'])})`;
    case 'relationships':
      return `${String(value['sourceEntity'])} -${String(value['relationType'])}/${String(value['kind'])}-> ${String(value['targetEntity'])}`;
    case 'stateChanges':
      return `${String(value['entityName'])}.${String(value['attributeKey'])} = ${String(value['toValue'])}`;
    case 'inconsistencies':
      return `${String(value['entityName'])} ${String(value['ruleCode'])} (${String(value['field'])})`;
  }
}

function evaluateSection<T, M extends object>(
  section: Section,
  items: T[],
  expectation: SectionExpectation<M> | undefined,
  match: Matcher<T, M>,
): { results: ExpectationResult[]; stats: SectionStats } {
  const stats: SectionStats = {
    expected: 0,
    hit: 0,
    forbidden: 0,
    forbiddenHit: 0,
    produced: 0,
    unexpected: 0,
  };
  const results: ExpectationResult[] = [];
  if (!expectation) {
    return { results, stats };
  }

  for (const matcher of expectation.mustInclude ?? []) {
    const passed = items.some((item) => match(item, matcher));
    stats.expected += 1;
    stats.hit += passed ? 1 : 0;
    results.push({
      section,
      kind: 'mustInclude',
      label: describeMatcher(matcher),
      passed,
    });
  }

  for (const matcher of expectation.mustNotInclude ?? []) {
    const offender = items.find((item) => match(item, matcher));
    stats.forbidden += 1;
    stats.forbiddenHit += offender ? 1 : 0;
    results.push({
      section,
      kind: 'mustNotInclude',
      label: offender
        ? `${describeMatcher(matcher)} -> got ${describeItem(section, offender)}`
        : describeMatcher(matcher),
      passed: !offender,
    });
  }

  if (expectation.exhaustive) {
    const covered = [
      ...(expectation.mustInclude ?? []),
      ...(expectation.allow ?? []),
    ];
    stats.produced = items.length;
    for (const item of items) {
      if (covered.some((matcher) => match(item, matcher))) {
        continue;
      }
      stats.unexpected += 1;
      results.push({
        section,
        kind: 'unexpected',
        label: describeItem(section, item),
        passed: false,
      });
    }
  }

  return { results, stats };
}

function containsEvidence(normalizedText: string, evidence: string): boolean {
  // Models often elide with "..." when quoting; each fragment must be literal.
  const fragments = evidence
    .split(/\.\.\.|…/)
    .map(normalize)
    .filter(Boolean);
  return (
    fragments.length > 0 &&
    fragments.every((fragment) => normalizedText.includes(fragment))
  );
}

function containsLabel(normalizedText: string, label: string): boolean {
  const normalized = normalize(label);
  return (
    normalized.length > 0 && ` ${normalizedText} `.includes(` ${normalized} `)
  );
}

function checkInvariants(
  evalCase: EvalCase,
  output: ExtractionResponse,
): InvariantResult[] {
  const results = new Map<InvariantCode, InvariantResult>();
  const record = (code: InvariantCode, ok: boolean, detail: string): void => {
    const current = results.get(code) ?? { code, checked: 0, violations: [] };
    current.checked += 1;
    if (!ok) {
      current.violations.push(detail);
    }
    results.set(code, current);
  };

  const text = normalize(evalCase.input.sceneText);
  const canonicalByLabel = new Map<string, string>();
  for (const known of evalCase.input.knownEntities) {
    for (const label of [known.canonicalName, ...known.aliases]) {
      canonicalByLabel.set(normalize(label), known.canonicalName);
    }
  }
  const extractedLabels = new Set(output.entities.flatMap(labelsOf));

  const checkEvidence = (
    owner: string,
    evidence: string[] | undefined,
  ): void => {
    const entries = (evidence ?? []).filter((entry) => entry?.trim());
    record('evidence_present', entries.length > 0, `${owner}: sin evidencia`);
    for (const entry of entries) {
      record(
        'evidence_grounded',
        containsEvidence(text, entry),
        `${owner}: "${entry}"`,
      );
    }
  };
  const checkCanonical = (owner: string, name: string): void => {
    const canonical = canonicalByLabel.get(normalize(name));
    if (canonical) {
      record(
        'canonical_names',
        normalize(canonical) === normalize(name),
        `${owner}: usó "${name}" en vez de "${canonical}"`,
      );
    }
  };
  const checkScore = (owner: string, field: string, value: number): void => {
    record(
      'scores_in_range',
      typeof value === 'number' && value >= 0 && value <= 1,
      `${owner}: ${field}=${String(value)}`,
    );
  };

  for (const entity of output.entities) {
    const owner = `entity ${entity.canonicalName}`;
    checkEvidence(owner, entity.evidence);
    checkCanonical(owner, entity.canonicalName);
    checkScore(owner, 'confidenceScore', entity.confidenceScore);
    for (const alias of entity.aliases ?? []) {
      record(
        'aliases_in_text',
        containsLabel(text, alias),
        `${owner}: alias "${alias}"`,
      );
    }
    if (String(entity.type) === 'OBJECT') {
      const name = normalize(entity.canonicalName).replace(LEADING_ARTICLE, '');
      record(
        'no_generic_objects',
        !GENERIC_OBJECTS.has(name),
        `${owner}: objeto genérico`,
      );
    }
  }

  for (const change of output.stateChanges) {
    const owner = `stateChange ${change.entityName}.${change.attributeKey}`;
    checkEvidence(owner, change.evidence);
    checkCanonical(owner, change.entityName);
    checkScore(owner, 'confidenceScore', change.confidenceScore);
    // The pipeline drops state changes on entities that are not confirmed.
    record(
      'references_resolvable',
      canonicalByLabel.has(normalize(change.entityName)),
      `${owner}: entidad no conocida (el pipeline la descarta)`,
    );
  }

  for (const relationship of output.relationships) {
    const owner = `relationship ${relationship.sourceEntity}->${relationship.targetEntity}`;
    checkEvidence(owner, relationship.evidence);
    checkScore(owner, 'intensity', relationship.intensity);
    for (const name of [relationship.sourceEntity, relationship.targetEntity]) {
      checkCanonical(owner, name);
      const label = normalize(name);
      record(
        'references_resolvable',
        canonicalByLabel.has(label) || extractedLabels.has(label),
        `${owner}: "${name}" no es conocida ni extraída (el pipeline la descarta)`,
      );
    }
  }

  for (const inconsistency of output.inconsistencies) {
    const owner = `inconsistency ${inconsistency.entityName} ${inconsistency.ruleCode}`;
    checkEvidence(owner, inconsistency.evidence);
    checkCanonical(owner, inconsistency.entityName);
    checkScore(owner, 'confidenceScore', inconsistency.confidenceScore);
    record(
      'references_resolvable',
      canonicalByLabel.has(normalize(inconsistency.entityName)),
      `${owner}: entidad no conocida (el pipeline la descarta)`,
    );
  }

  return [...results.values()];
}

export function evaluateOutput(
  evalCase: EvalCase,
  output: ExtractionResponse,
): RunEvaluation {
  const sections = {
    entities: evaluateSection(
      'entities',
      output.entities,
      evalCase.expect.entities,
      matchEntity,
    ),
    relationships: evaluateSection(
      'relationships',
      output.relationships,
      evalCase.expect.relationships,
      matchRelationship,
    ),
    stateChanges: evaluateSection(
      'stateChanges',
      output.stateChanges,
      evalCase.expect.stateChanges,
      matchStateChange,
    ),
    inconsistencies: evaluateSection(
      'inconsistencies',
      output.inconsistencies,
      evalCase.expect.inconsistencies,
      matchInconsistency,
    ),
  };
  const expectations = Object.values(sections).flatMap(
    (section) => section.results,
  );

  return {
    passed: expectations.every((result) => result.passed),
    expectations,
    invariants: checkInvariants(evalCase, output),
    sections: {
      entities: sections.entities.stats,
      relationships: sections.relationships.stats,
      stateChanges: sections.stateChanges.stats,
      inconsistencies: sections.inconsistencies.stats,
    },
  };
}
