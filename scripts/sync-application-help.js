const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backendRoot = path.resolve(__dirname, '..');
const wikiRoot = path.resolve(backendRoot, '..', 'plumia-wiki');
const generator = path.join(wikiRoot, 'scripts', 'build-wiki-index.js');
const output = path.join(
  backendRoot,
  'src',
  'chat',
  'data',
  'application-help.jsonl',
);

if (!fs.existsSync(generator)) {
  process.stderr.write(
    `No se encontró el generador de la wiki en ${generator}\n`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [generator, '--out', output], {
  cwd: wikiRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
