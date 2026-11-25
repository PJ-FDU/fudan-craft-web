import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = mkdtempSync(join(tmpdir(), 'fudancraft-rifleman-source-'));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited ${result.status}`);
}

try {
  run(process.execPath, ['--import', 'tsx', 'scripts/export-blender-source.ts', source]);
  run(process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', [
    '--background', '--factory-startup', '--threads', '0', '--python-exit-code', '1',
    '--python', 'scripts/build-rifleman.py', '--',
    '--template', join(source, 'source.json'),
    '--output', resolve(root, 'artifacts/rifleman'),
    ...process.argv.slice(2),
  ]);
  if (!process.argv.includes('--preview-only')) {
    run(process.execPath, ['scripts/publish-rifleman.mjs', source]);
  }
} finally {
  rmSync(source, { recursive: true, force: true });
}
