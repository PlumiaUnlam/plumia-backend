/**
 * Compares two eval results and exits with code 1 when there are regressions.
 *
 *   pnpm run eval:extraction:compare <baseline.json> <candidate.json> [--threshold 0.8]
 */
import { readFileSync } from 'node:fs';
import type { EvalResultFile } from './lib/eval-case.types';
import {
  compareResults,
  DEFAULT_PASS_THRESHOLD,
  printComparison,
} from './lib/report';

function load(file: string): EvalResultFile {
  return JSON.parse(readFileSync(file, 'utf8')) as EvalResultFile;
}

const args = process.argv.slice(2);
const thresholdIndex = args.indexOf('--threshold');
const threshold =
  thresholdIndex === -1
    ? DEFAULT_PASS_THRESHOLD
    : Number(args[thresholdIndex + 1]);
const files = args.filter(
  (arg, index) =>
    !arg.startsWith('--') &&
    (thresholdIndex === -1 || index !== thresholdIndex + 1),
);

if (files.length !== 2) {
  console.error(
    'Uso: pnpm run eval:extraction:compare <baseline.json> <candidate.json> [--threshold 0.8]',
  );
  process.exit(2);
}

const baseline = load(files[0]!);
const candidate = load(files[1]!);
const comparison = compareResults(baseline, candidate, threshold);
printComparison(baseline, candidate, comparison);
process.exit(comparison.regressions.length > 0 ? 1 : 0);
