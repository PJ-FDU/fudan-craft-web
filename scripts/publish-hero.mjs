import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { removePackedModel } from './packed-models.mjs';

const HEROES = {
  worker:     { key: 'industrial:worker',    pack: 'industrial', script: 'scripts/build-worker-hero.py', output: 'artifacts/worker-hero', blend: 'engineering-worker.blend' },
  sniper:     { key: 'industrial:sniper',    pack: 'industrial', script: 'scripts/build-sniper-hero.py', output: 'artifacts/sniper-hero', blend: 'ghost-sniper.blend' },
  rifleman:   { key: 'industrial:soldier',   pack: 'industrial', script: 'scripts/build-rifleman.py',   output: 'artifacts/rifleman' },
  medic:      { key: 'industrial:medic',     pack: 'industrial', script: 'scripts/build-medic.py',      output: 'artifacts/medic' },
  commander:  { key: 'industrial:commander', pack: 'industrial', script: 'scripts/build-commander.py',  output: 'artifacts/commander' },
  ranger:     { key: 'relay:ranger',         pack: 'relay',      script: 'scripts/build-ranger.py',     output: 'artifacts/ranger' },
  observer:   { key: 'relay:observer',       pack: 'relay',      script: 'scripts/build-observer.py',   output: 'artifacts/observer' },
  pathfinder: { key: 'relay:pathfinder',     pack: 'relay',      script: 'scripts/build-pathfinder.py', output: 'artifacts/pathfinder' },
  mech:       { key: 'industrial:mech',      pack: 'industrial', script: 'scripts/build-mech.py',       output: 'artifacts/mech' },
};

const name = process.argv[2];
if (!name || !(name in HEROES)) {
  throw Error(`Unknown hero "${name}". Expected one of: ${Object.keys(HEROES).join(', ')}`);
}
const { key, pack, script, output, blend = `${name}.blend` } = HEROES[name];
const root = resolve(import.meta.dirname, '..');
const project = resolve(process.argv[4] ?? root);
const directory = resolve(project, 'public/assets/blender-sculpt-v2');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');

let sourceDir = process.argv[3];
let tempSource = null;
if (!sourceDir) {
  tempSource = mkdtempSync(join(tmpdir(), `fudancraft-${name}-publish-`));
  const exported = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/export-blender-source.ts', tempSource], {
    cwd: root, stdio: 'inherit',
  });
  if (exported.status !== 0) throw Error(`export-blender-source exited ${exported.status}`);
  sourceDir = tempSource;
}

try {
  const manifestPath = resolve(directory, 'manifest.json');
  const manifest = json(manifestPath);
  const source = json(resolve(sourceDir, 'source.json'));
  const bake = `${output}/${name}-bake.json`;
  const record = json(resolve(project, bake))[0];
  assert.equal(record.key, key);
  assert.ok(record.projection.uvPixels > 0 &&
    record.projection.missedProjectionPixels / record.projection.uvPixels <= .05);
  assert.equal(record.scriptHash, hash(script), `${name} bake is stale`);
  const alreadyIndependent = manifest.templates[key]?.surface === name;
  if (!alreadyIndependent) {
    assert.equal(manifest.scriptHash, hash('scripts/build-sculpt-assets.py'), 'Common sculpt library is stale');
  }
  assert.deepEqual(record.template.rig, source.templates[key].rig, `${name} rig changed`);
  assert.deepEqual(record.template.moving, source.templates[key].moving, `${name} articulated parts changed`);
  assert.equal(record.template.surface, name);
  for (const {file,sha256} of Object.values(record.textureSources ?? {})) {
    assert.equal(sha256, hash(file), `${name} texture source changed: ${file}`);
  }

  const surface = { albedo: `${name}-albedo.png`, normal: `${name}-normal.png`, orm: `${name}-orm.png` };
  const files = [`${name}.glb`, ...Object.values(surface)].map(file =>
    [file, readFileSync(resolve(project, output, file))]);
  for (const [file, bytes] of files.slice(1)) {
    assert.equal(bytes.readUInt32BE(16), record.tileSize, file);
    assert.equal(bytes.readUInt32BE(20), record.tileSize, file);
  }

  manifest.templates[key] = record.template;
  manifest.surfaces[name] = surface;
  manifest.packs = [...new Set([...manifest.packs, `${name}.glb`])];
  manifest.textures = [...new Set([...manifest.textures, ...Object.values(surface)])];
  manifest.generators ??= {};
  manifest.generators[name] = { script, scriptHash: record.scriptHash, bake, blend: `${output}/${blend}` };

  function atomicWrite(path, bytes) {
    writeFileSync(path + '.tmp', bytes);
    renameSync(path + '.tmp', path);
  }
  const changes = files.map(([file, bytes]) => [resolve(directory, file), bytes]);
  if (!alreadyIndependent) {
    const packPath = resolve(directory, `${pack}.glb`);
    const recordsPath = resolve(project, `artifacts/blender-sculpt/${pack}-bake.json`);
    const original = readFileSync(packPath);
    const pruned = removePackedModel(original, key);
    const records = json(recordsPath).filter(item => item.key !== key);
    if (pruned !== original) changes.push([packPath, pruned]);
    changes.push([recordsPath, JSON.stringify(records, null, 2) + '\n']);
  }
  for (const [path, bytes] of changes) atomicWrite(path, bytes);
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({
    name, key, faces: record.lowFaces, highFaces: record.highFaces,
    textureSize: record.tileSize, rigJoints: record.template.rig.length,
    textureSources: Object.keys(record.textureSources ?? {}),
  }));
} finally {
  if (tempSource) rmSync(tempSource, { recursive: true, force: true });
}
