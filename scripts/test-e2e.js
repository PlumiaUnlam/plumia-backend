const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const composeFile = path.join(root, 'docker-compose.e2e.yml');
const prismaCli = path.join(
  root,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const jestCli = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
const databaseUrl =
  'postgresql://plumia_e2e:plumia_e2e@127.0.0.1:55432/plumia_e2e?schema=public';

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: 'test',
  APP_ROLE: 'web',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function dockerCompose(args, options = {}) {
  run('docker', ['compose', '-f', composeFile, '-p', 'plumia-e2e', ...args], {
    ...options,
  });
}

function ensureDockerIsAvailable() {
  const result = spawnSync('docker', ['--version'], {
    cwd: root,
    env,
    stdio: 'ignore',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    throw new Error('Docker CLI is required to run the isolated e2e suite.');
  }
}

function prisma(args) {
  run(process.execPath, [prismaCli, ...args]);
}

function jest(args) {
  run(process.execPath, [jestCli, ...args]);
}

function waitForPostgres() {
  const startedAt = Date.now();
  const timeoutMs = 60_000;

  while (Date.now() - startedAt < timeoutMs) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        composeFile,
        '-p',
        'plumia-e2e',
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        'plumia_e2e',
        '-d',
        'plumia_e2e',
      ],
      { cwd: root, env, stdio: 'ignore', shell: false },
    );

    if (result.status === 0) {
      return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  throw new Error('Postgres e2e did not become ready in time.');
}

let exitCode = 0;
let shouldCleanup = false;

try {
  ensureDockerIsAvailable();
  try {
    dockerCompose(['down', '--volumes', '--remove-orphans'], {
      stdio: 'ignore',
    });
  } catch {
    // Best-effort cleanup before recreating the isolated e2e stack.
  }
  dockerCompose(['up', '-d', '--force-recreate', '--renew-anon-volumes']);
  shouldCleanup = true;
  waitForPostgres();
  prisma(['migrate', 'deploy']);
  jest(['--config', './test/jest-e2e.config.js', '--runInBand']);
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (shouldCleanup) {
    try {
      dockerCompose(['down', '--volumes', '--remove-orphans']);
    } catch (error) {
      exitCode = 1;
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

process.exit(exitCode);
