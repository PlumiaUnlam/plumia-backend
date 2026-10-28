import type {
  CaseResult,
  EvalResultFile,
  EvalSummary,
  InvariantCode,
  Ratio,
} from './eval-case.types';
import { SECTIONS } from './eval-case.types';

const INVARIANTS: InvariantCode[] = [
  'evidence_present',
  'evidence_grounded',
  'canonical_names',
  'references_resolvable',
  'aliases_in_text',
  'no_generic_objects',
  'scores_in_range',
];

export function print(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** A case counts as passing when it passes at least this share of its runs. */
export const DEFAULT_PASS_THRESHOLD = 0.8;

function ratio(num: number, den: number): Ratio {
  return { num, den, rate: den === 0 ? null : num / den };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)]!);
}

export function summarize(
  cases: CaseResult[],
  runsPerCase: number,
): EvalSummary {
  const runs = cases.flatMap((result) => result.runs);
  const evaluations = runs.flatMap((run) =>
    run.evaluation ? [run.evaluation] : [],
  );

  const sections = {} as EvalSummary['sections'];
  for (const section of SECTIONS) {
    const stats = evaluations.map((evaluation) => evaluation.sections[section]);
    const sum = (key: keyof (typeof stats)[number]): number =>
      stats.reduce((total, item) => total + item[key], 0);
    const produced = sum('produced');
    sections[section] = {
      recall: ratio(sum('hit'), sum('expected')),
      forbiddenRate: ratio(sum('forbiddenHit'), sum('forbidden')),
      precision: ratio(produced - sum('unexpected'), produced),
    };
  }

  const invariants = {} as EvalSummary['invariants'];
  for (const code of INVARIANTS) {
    let checked = 0;
    let violations = 0;
    for (const evaluation of evaluations) {
      const result = evaluation.invariants.find((item) => item.code === code);
      checked += result?.checked ?? 0;
      violations += result?.violations.length ?? 0;
    }
    // Reported as compliance: share of checked items without violations.
    invariants[code] = ratio(checked - violations, checked);
  }

  const passRates = cases.map((result) => result.passRate);
  return {
    cases: cases.length,
    runsPerCase,
    meanPassRate:
      passRates.reduce((total, rate) => total + rate, 0) /
      Math.max(1, passRates.length),
    fullyPassingCases: passRates.filter((rate) => rate === 1).length,
    flakyCases: passRates.filter((rate) => rate > 0 && rate < 1).length,
    errors: runs.filter((run) => !run.ok).length,
    latencyP50Ms: percentile(
      runs.map((run) => run.latencyMs),
      0.5,
    ),
    latencyP95Ms: percentile(
      runs.map((run) => run.latencyMs),
      0.95,
    ),
    sections,
    invariants,
  };
}

export function formatRate(value: Ratio | number | null): string {
  const rate = typeof value === 'number' || value === null ? value : value.rate;
  if (rate === null) {
    return '   n/a';
  }
  return `${(rate * 100).toFixed(1).padStart(5)}%`;
}

function formatRatio(value: Ratio): string {
  return `${formatRate(value)} (${value.num}/${value.den})`;
}

export function printSummary(result: EvalResultFile): void {
  const { meta, summary } = result;
  const lines: string[] = [
    '',
    `Prompt ${meta.promptHash} · ${meta.provider}/${meta.model}${meta.effort ? ` (effort ${meta.effort})` : ''} · ${summary.runsPerCase} corridas por caso`,
    '',
    'Casos',
  ];

  for (const caseResult of result.cases) {
    const marker =
      caseResult.passRate === 1
        ? 'OK  '
        : caseResult.passRate > 0
          ? '~   '
          : 'FAIL';
    lines.push(
      `  ${marker} ${formatRate(caseResult.passRate)}  ${caseResult.id}`,
    );
    if (caseResult.passRate < 1) {
      for (const failure of collectFailures(caseResult)) {
        lines.push(`         - ${failure}`);
      }
    }
  }

  lines.push(
    '',
    `Pass rate medio ${formatRate(summary.meanPassRate)} · ${summary.fullyPassingCases}/${summary.cases} siempre pasan · ${summary.flakyCases} inestables · ${summary.errors} errores`,
    `Latencia p50 ${summary.latencyP50Ms} ms · p95 ${summary.latencyP95Ms} ms`,
    '',
    'Sección           recall              prohibidos          precisión (exhaustivas)',
  );
  for (const section of SECTIONS) {
    const stats = summary.sections[section];
    lines.push(
      `  ${section.padEnd(16)}${formatRatio(stats.recall).padEnd(20)}${formatRatio(stats.forbiddenRate).padEnd(20)}${formatRatio(stats.precision)}`,
    );
  }

  lines.push('', 'Invariantes (cumplimiento)');
  for (const [code, value] of Object.entries(summary.invariants)) {
    lines.push(`  ${code.padEnd(24)}${formatRatio(value)}`);
  }
  print(lines);
}

/** Failure labels for a case, with how many runs hit each one. */
export function collectFailures(caseResult: CaseResult): string[] {
  const counts = new Map<string, number>();
  for (const run of caseResult.runs) {
    const labels = run.ok
      ? (run.evaluation?.expectations ?? [])
          .filter((result) => !result.passed)
          .map((result) => `${result.section} ${result.kind}: ${result.label}`)
      : [`error: ${run.error ?? 'desconocido'}`];
    for (const label of new Set(labels)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(
    ([label, count]) => `[${count}/${caseResult.runs.length}] ${label}`,
  );
}

export interface Comparison {
  regressions: string[];
  improvements: string[];
  stillFailing: string[];
  newCases: string[];
  removedCases: string[];
}

export function compareResults(
  baseline: EvalResultFile,
  candidate: EvalResultFile,
  threshold = DEFAULT_PASS_THRESHOLD,
): Comparison {
  const baselineById = new Map(baseline.cases.map((item) => [item.id, item]));
  const candidateIds = new Set(candidate.cases.map((item) => item.id));
  const comparison: Comparison = {
    regressions: [],
    improvements: [],
    stillFailing: [],
    newCases: [],
    removedCases: baseline.cases
      .filter((item) => !candidateIds.has(item.id))
      .map((item) => item.id),
  };

  for (const current of candidate.cases) {
    const previous = baselineById.get(current.id);
    if (!previous) {
      comparison.newCases.push(current.id);
      continue;
    }
    const label = `${current.id}: ${formatRate(previous.passRate).trim()} -> ${formatRate(current.passRate).trim()}`;
    const passedBefore = previous.passRate >= threshold;
    const passesNow = current.passRate >= threshold;
    if (passedBefore && !passesNow) {
      comparison.regressions.push(label);
    } else if (!passedBefore && passesNow) {
      comparison.improvements.push(label);
    } else if (!passesNow) {
      comparison.stillFailing.push(label);
    }
  }
  return comparison;
}

function delta(before: Ratio | number, after: Ratio | number): string {
  const rateBefore = typeof before === 'number' ? before : before.rate;
  const rateAfter = typeof after === 'number' ? after : after.rate;
  const base = `${formatRate(rateBefore)} -> ${formatRate(rateAfter)}`;
  if (rateBefore === null || rateAfter === null) {
    return base;
  }
  const diff = (rateAfter - rateBefore) * 100;
  const sign = diff > 0 ? '+' : '';
  return `${base}  (${sign}${diff.toFixed(1)} pp)`;
}

export function printComparison(
  baseline: EvalResultFile,
  candidate: EvalResultFile,
  comparison: Comparison,
): void {
  const lines: string[] = [''];
  const describeMeta = (result: EvalResultFile): string =>
    `prompt ${result.meta.promptHash} · ${result.meta.provider}/${result.meta.model} · ${result.meta.runs} corridas · ${result.meta.startedAt}`;
  lines.push(`Baseline:  ${describeMeta(baseline)}`);
  lines.push(`Candidato: ${describeMeta(candidate)}`);

  if (
    baseline.meta.provider !== candidate.meta.provider ||
    baseline.meta.model !== candidate.meta.model ||
    baseline.meta.effort !== candidate.meta.effort
  ) {
    lines.push(
      '',
      'ATENCIÓN: cambió el modelo/proveedor/effort; las diferencias no se deben solo al prompt.',
    );
  }

  const section = (title: string, items: string[]): void => {
    lines.push('', `${title} (${items.length})`);
    for (const item of items) {
      lines.push(`  ${item}`);
    }
  };
  section('Regresiones', comparison.regressions);
  section('Mejoras', comparison.improvements);
  section('Siguen fallando', comparison.stillFailing);
  if (comparison.newCases.length > 0) {
    section('Casos nuevos (sin baseline)', comparison.newCases);
  }
  if (comparison.removedCases.length > 0) {
    section('Casos que ya no se corrieron', comparison.removedCases);
  }

  lines.push('', 'Métricas');
  lines.push(
    `  pass rate medio            ${delta(baseline.summary.meanPassRate, candidate.summary.meanPassRate)}`,
  );
  for (const name of SECTIONS) {
    const before = baseline.summary.sections[name];
    const after = candidate.summary.sections[name];
    lines.push(
      `  ${name}.recall`.padEnd(29) + delta(before.recall, after.recall),
    );
    lines.push(
      `  ${name}.prohibidos`.padEnd(29) +
        delta(before.forbiddenRate, after.forbiddenRate),
    );
    lines.push(
      `  ${name}.precisión`.padEnd(29) +
        delta(before.precision, after.precision),
    );
  }
  for (const [code, after] of Object.entries(candidate.summary.invariants)) {
    const before =
      baseline.summary.invariants[code as InvariantCode] ?? ratio(0, 0);
    lines.push(`  ${code}`.padEnd(29) + delta(before, after));
  }
  lines.push(
    `  latencia p50               ${baseline.summary.latencyP50Ms} -> ${candidate.summary.latencyP50Ms} ms`,
  );
  print(lines);
}
