import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const name = process.argv[2];
const valid = ['medic', 'commander', 'ranger', 'observer', 'pathfinder', 'mech'];
if (!name || !valid.includes(name)) {
  throw Error(`Usage: node scripts/build-hero.mjs <${valid.join('|')}> [--resolution 2048] [--preview-only]`);
}
const extraArgs = process.argv.slice(3);
const root = resolve(import.meta.dirname, '..');
const source = mkdtempSync(join(tmpdir(), `fudancraft-${name}-source-`));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited ${result.status}`);
}

try {
  run(process.execPath, ['--import', 'tsx', 'scripts/export-blender-source.ts', source]);
  run(process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', [
    '--background', '--factory-startup', '--threads', '0', '--python-exit-code', '1',
    '--python', `scripts/build-${name}.py`, '--',
    '--template', join(source, 'source.json'),
    '--output', resolve(root, `artifacts/${name}`),
    ...extraArgs,
  ]);
  if (!extraArgs.includes('--preview-only')) {
    run(process.execPath, ['scripts/publish-hero.mjs', name, source]);
  }
} finally {
  rmSync(source, { recursive: true, force: true });
}
