import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..'), source = resolve(root, '.cache/sculpt-source');
mkdirSync(source, {recursive: true});
function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['--import', 'tsx', 'scripts/export-blender-source.ts', source]);
run(process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', [
  '--background', '--factory-startup', '--threads', '4', '--python-exit-code', '1',
  '--python', 'scripts/build-worker-hero.py', '--', '--project', root, '--source', source,
  ...process.argv.slice(2),
]);
if (!process.argv.includes('--preview-only')) {
  run(process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', [
    '--background', '--factory-startup', '--threads', '4', '--python-exit-code', '1',
    '--python', 'scripts/prune-worker-source.py', '--', '--project', root,
  ]);
  run(process.execPath, ['scripts/publish-worker-hero.mjs']);
}
