/**
 * Runs the entity-extraction prompt against the eval cases and scores it.
 *
 *   pnpm run eval:extraction [--runs 3] [--filter <id|tag:x>] [--concurrency 4]
 *                            [--provider anthropic|gemini] [--model <id>]
 *                            [--effort <level>] [--out <file>]
 *
 * Calls the real model with the API keys from .env (it costs money and is not
 * deterministic), so it is not part of `pnpm run test`.
 */
import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { EntityExtractionClient } from '../../../src/system/entity-extraction/entity-extraction.client';
import { ENTITY_EXTRACTION_PROMPT } from '../../../src/system/entity-extraction/prompts/entity-extraction.prompt';
import { evaluateOutput } from './lib/checks';
import type {
  CaseResult,
  EvalCase,
  EvalResultFile,
  RunRecord,
} from './lib/eval-case.types';
import { print, printSummary, summarize } from './lib/report';

const ROOT = path.resolve(__dirname, '../../..');
const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key?.startsWith('--')) {
      args.set(key.slice(2), argv[index + 1] ?? '');
      index += 1;
    }
  }
  return args;
}

function loadCases(filter: string | null): EvalCase[] {
  const cases = readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) =>
        JSON.parse(
          readFileSync(path.join(CASES_DIR, file), 'utf8'),
        ) as EvalCase,
    );
  if (!filter) {
    return cases;
  }
  if (filter.startsWith('tag:')) {
    const tag = filter.slice(4);
    return cases.filter((item) => item.tags.includes(tag));
  }
  return cases.filter((item) => item.id.includes(filter));
}

function env(key: string): string | null {
  const value = process.env[key]?.trim();
  if (!value) {
    return null;
  }
  return value;
}

/**
 * The client's constructor differs across branches (some take a
 * UserApiKeyService for per-user keys). Passing a stub that never finds a user
 * key keeps the eval on the server credentials from .env on any branch.
 */
function createClient(): EntityExtractionClient {
  const noUserKeys = { getActiveGeminiKey: () => Promise.resolve(null) };
  const Client = EntityExtractionClient as unknown as new (
    ...args: unknown[]
  ) => EntityExtractionClient;
  return new Client(new ConfigService(), noUserKeys);
}

function git(command: string): string | null {
  try {
    return execSync(`git ${command}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

async function runOnce(
  client: EntityExtractionClient,
  evalCase: EvalCase,
): Promise<RunRecord> {
  const startedAt = Date.now();
  try {
    const output = await client.extractEntities(evalCase.input);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      output,
      evaluation: evaluateOutput(evalCase, output),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }
}

async function main(): Promise<void> {
  loadEnv({ path: path.join(ROOT, '.env'), quiet: true });
  Logger.overrideLogger(['error', 'warn']);

  const args = parseArgs(process.argv.slice(2));
  const overrides: Record<string, string | undefined> = {
    ENTITY_EXTRACTION_PROVIDER: args.get('provider'),
    ENTITY_EXTRACTION_MODEL: args.get('model'),
    ENTITY_EXTRACTION_EFFORT: args.get('effort'),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value) {
      process.env[key] = value;
    }
  }

  const runs = Number(args.get('runs') ?? 3);
  const concurrency = Number(args.get('concurrency') ?? 4);
  const filter = args.get('filter') ?? null;
  const cases = loadCases(filter);
  if (cases.length === 0) {
    throw new Error(`No hay casos para el filtro "${filter ?? ''}"`);
  }

  const provider = env('ENTITY_EXTRACTION_PROVIDER') ?? 'gemini';
  const client = createClient();
  if (!client.hasExtractionModel()) {
    throw new Error('Falta configurar el modelo de extracción en .env');
  }

  print([
    `Corriendo ${cases.length} casos x ${runs} corridas (${cases.length * runs} llamadas, concurrencia ${concurrency})...`,
  ]);
  const startedAt = new Date();
  let done = 0;
  const tasks = cases.flatMap((evalCase) =>
    Array.from({ length: runs }, () => async () => {
      const record = await runOnce(client, evalCase);
      done += 1;
      process.stdout.write(`\r  ${done}/${cases.length * runs}`);
      return { id: evalCase.id, record };
    }),
  );
  const records = await runPool(tasks, concurrency);
  process.stdout.write('\n');

  const caseResults: CaseResult[] = cases.map((evalCase) => {
    const caseRuns = records
      .filter((item) => item.id === evalCase.id)
      .map((item) => item.record);
    return {
      id: evalCase.id,
      tags: evalCase.tags,
      passRate:
        caseRuns.filter((run) => run.evaluation?.passed).length /
        caseRuns.length,
      runs: caseRuns,
    };
  });

  const gitStatus = git('status --porcelain');
  const result: EvalResultFile = {
    meta: {
      startedAt: startedAt.toISOString(),
      promptHash: createHash('sha256')
        .update(ENTITY_EXTRACTION_PROMPT)
        .digest('hex')
        .slice(0, 12),
      provider,
      model: env('ENTITY_EXTRACTION_MODEL') ?? '(default del cliente)',
      effort: env('ENTITY_EXTRACTION_EFFORT'),
      runs,
      filter,
      gitCommit: git('rev-parse --short HEAD'),
      gitDirty: gitStatus === null ? null : gitStatus.length > 0,
    },
    summary: summarize(caseResults, runs),
    cases: caseResults,
  };

  const out =
    args.get('out') ??
    path.join(
      RESULTS_DIR,
      `${startedAt.toISOString().replace(/[:.]/g, '-')}-${result.meta.promptHash}.json`,
    );
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

  printSummary(result);
  print(['', `Resultado guardado en ${path.resolve(out)}`]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
