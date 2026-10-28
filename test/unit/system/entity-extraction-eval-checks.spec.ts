import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EntityType } from '../../../src/knowledge/domain/entity-type';
import type {
  ExtractionCandidate,
  ExtractionResponse,
} from '../../../src/system/entity-extraction/entity-extraction.types';
import { evaluateOutput } from '../../evals/entity-extraction/lib/checks';
import type {
  CaseResult,
  EvalCase,
  RunEvaluation,
} from '../../evals/entity-extraction/lib/eval-case.types';
import {
  compareResults,
  summarize,
} from '../../evals/entity-extraction/lib/report';

const CASES_DIR = path.join(__dirname, '../../evals/entity-extraction/cases');

function emptyOutput(
  overrides: Partial<ExtractionResponse> = {},
): ExtractionResponse {
  return {
    entities: [],
    stateChanges: [],
    relationships: [],
    inconsistencies: [],
    ...overrides,
  };
}

function entity(
  canonicalName: string,
  type: EntityType,
  extra: { aliases?: string[]; evidence?: string[] } = {},
): ExtractionCandidate {
  return {
    canonicalName,
    aliases: extra.aliases ?? [],
    type,
    description: null,
    attributes: {},
    imageUrl: null,
    confidenceScore: 0.9,
    evidence: extra.evidence ?? [canonicalName],
  };
}

const baseCase: EvalCase = {
  id: 'test',
  description: '',
  tags: [],
  input: {
    sceneText:
      'Bartolomé, a quien todos llamaban el Tuerto, dejó el vaso sobre la mesa.',
    knownEntities: [
      {
        canonicalName: 'Bartolomé Ríos',
        aliases: ['Bartolomé'],
        type: 'CHARACTER',
      },
    ],
  },
  expect: {},
};

describe('entity extraction eval checks', () => {
  it('matches entities by normalized name or alias and type', () => {
    const result = evaluateOutput(
      {
        ...baseCase,
        expect: {
          entities: {
            mustInclude: [
              {
                name: 'bartolome rios',
                type: 'CHARACTER',
                aliasesInclude: ['Tuerto'],
              },
            ],
          },
        },
      },
      emptyOutput({
        entities: [
          entity('Bartolomé Ríos', EntityType.CHARACTER, {
            aliases: ['el Tuerto'],
          }),
        ],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.sections.entities).toMatchObject({ expected: 1, hit: 1 });
  });

  it('fails on forbidden items and, when exhaustive, on unexpected ones', () => {
    const result = evaluateOutput(
      {
        ...baseCase,
        expect: {
          entities: {
            mustNotInclude: [{ name: 'mesa' }],
            exhaustive: true,
            allow: [{ name: 'Bartolomé Ríos' }],
          },
        },
      },
      emptyOutput({
        entities: [
          entity('Bartolomé Ríos', EntityType.CHARACTER),
          entity('mesa', EntityType.OBJECT),
          entity('vaso', EntityType.OBJECT),
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(
      result.expectations
        .filter((item) => !item.passed)
        .map((item) => item.kind),
    ).toEqual(['mustNotInclude', 'unexpected', 'unexpected']);
    expect(result.sections.entities).toMatchObject({
      forbiddenHit: 1,
      produced: 3,
      unexpected: 2,
    });
  });

  it('only matches canonical names when canonicalOnly is set', () => {
    const output = emptyOutput({
      entities: [
        entity('Bartolomé Ríos', EntityType.CHARACTER, {
          aliases: ['el Tuerto'],
        }),
      ],
    });

    const result = evaluateOutput(
      {
        ...baseCase,
        expect: {
          entities: {
            mustNotInclude: [{ name: 'el Tuerto', canonicalOnly: true }],
          },
        },
      },
      output,
    );

    expect(result.passed).toBe(true);
  });

  it('respects relationship direction unless anyDirection is set', () => {
    const relationship = {
      kind: 'CREATE' as const,
      sourceEntity: 'Pablo',
      targetEntity: 'Ingrid',
      relationType: 'MENTOR' as never,
      description: null,
      intensity: 0.7,
      confidenceScore: 0.9,
      evidence: ['Ingrid'],
    };
    const output = emptyOutput({ relationships: [relationship] });
    const evalFor = (anyDirection: boolean): RunEvaluation =>
      evaluateOutput(
        {
          ...baseCase,
          expect: {
            relationships: {
              mustInclude: [
                {
                  source: 'Ingrid',
                  target: 'Pablo',
                  type: 'MENTOR',
                  anyDirection,
                },
              ],
            },
          },
        },
        output,
      );

    expect(evalFor(false).passed).toBe(false);
    expect(evalFor(true).passed).toBe(true);
  });

  it('reports invariant violations without failing the case', () => {
    const result = evaluateOutput(
      baseCase,
      emptyOutput({
        entities: [
          entity('Bartolomé', EntityType.CHARACTER, {
            evidence: ['dejó el vaso ... la mesa', 'texto inventado'],
          }),
          entity('vaso', EntityType.OBJECT),
        ],
        stateChanges: [
          {
            entityName: 'Desconocido',
            attributeKey: 'location',
            fromValue: null,
            toValue: 'puerto',
            confidenceScore: 1.4,
            evidence: [],
          },
        ],
      }),
    );
    const violations = Object.fromEntries(
      result.invariants.map((item) => [item.code, item.violations.length]),
    );

    expect(result.passed).toBe(true);
    expect(violations).toMatchObject({
      evidence_grounded: 1,
      evidence_present: 1,
      canonical_names: 1,
      no_generic_objects: 1,
      references_resolvable: 1,
      scores_in_range: 1,
    });
  });

  it('summarizes pass rates and flags regressions against a baseline', () => {
    const passing = evaluateOutput(baseCase, emptyOutput());
    const caseResult = (passRate: number): CaseResult => ({
      id: 'case-a',
      tags: [],
      passRate,
      runs: [{ ok: true, latencyMs: 100, evaluation: passing }],
    });
    const meta = {
      startedAt: '',
      promptHash: 'x',
      provider: 'anthropic',
      model: 'm',
      effort: null,
      runs: 1,
      filter: null,
      gitCommit: null,
      gitDirty: null,
    };
    const baseline = {
      meta,
      summary: summarize([caseResult(1)], 1),
      cases: [caseResult(1)],
    };
    const candidate = {
      meta,
      summary: summarize([caseResult(0.4)], 1),
      cases: [caseResult(0.4)],
    };

    expect(baseline.summary.meanPassRate).toBe(1);
    expect(compareResults(baseline, candidate).regressions).toHaveLength(1);
    expect(compareResults(candidate, baseline).improvements).toHaveLength(1);
  });

  it('keeps every eval case file well formed', () => {
    const files = readdirSync(CASES_DIR).filter((file) =>
      file.endsWith('.json'),
    );
    const cases = files.map(
      (file) =>
        JSON.parse(
          readFileSync(path.join(CASES_DIR, file), 'utf8'),
        ) as EvalCase,
    );

    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    for (const [index, item] of cases.entries()) {
      expect(`${item.id}.json`).toBe(files[index]);
      expect(item.input.sceneText.trim()).not.toBe('');
      expect(Object.keys(item.expect).length).toBeGreaterThan(0);
    }
  });
});
