import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { removePackedModel } from './packed-models.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'public/assets/blender-sculpt-v2');
const output = 'artifacts/rifleman';
const key = 'industrial:soldier';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');

let sourceDir = process.argv[2];
let tempSource = null;
if (!sourceDir) {
  tempSource = mkdtempSync(join(tmpdir(), 'fudancraft-rifleman-publish-'));
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
  const recordsPath = resolve(root, 'artifacts/blender-sculpt/industrial-bake.json');
  const records = json(recordsPath).filter(record => record.key !== key);
  const bake = output + '/rifleman-bake.json';
  const script = 'scripts/build-rifleman.py';
  const record = json(resolve(root, bake))[0];
  assert.equal(record.key, key);
  assert.ok(record.projection.uvPixels > 0 &&
    record.projection.missedProjectionPixels / record.projection.uvPixels <= .05);
  assert.equal(record.scriptHash, hash(script), 'Rifleman bake is stale');
  assert.equal(manifest.scriptHash, hash('scripts/build-sculpt-assets.py'), 'Common sculpt library is stale');
  assert.deepEqual(record.template.rig, source.templates[key].rig, 'Rifleman rig changed');
  assert.equal(record.template.surface, 'rifleman');

  const surface = { albedo: 'rifleman-albedo.png', normal: 'rifleman-normal.png', orm: 'rifleman-orm.png' };
  const files = ['rifleman.glb', ...Object.values(surface)].map(name =>
    [name, readFileSync(resolve(root, output, name))]);
  const industrialPath = resolve(directory, 'industrial.glb');
  const original = readFileSync(industrialPath);
  const industrial = removePackedModel(original, key);

  manifest.templates[key] = record.template;
  manifest.surfaces.rifleman = surface;
  manifest.packs = [...new Set([...manifest.packs, 'rifleman.glb'])];
  manifest.textures = [...new Set([...manifest.textures, ...Object.values(surface)])];
  manifest.generators ??= {};
  manifest.generators.rifleman = { script, scriptHash: record.scriptHash, bake, blend: output + '/rifleman.blend' };

  function atomicWrite(path, bytes) {
    writeFileSync(path + '.tmp', bytes);
    renameSync(path + '.tmp', path);
  }
  for (const [name, bytes] of files) atomicWrite(resolve(directory, name), bytes);
  if (industrial !== original) atomicWrite(industrialPath, industrial);
  atomicWrite(recordsPath, JSON.stringify(records, null, 2) + '\n');
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({
    key, faces: record.lowFaces, highFaces: record.highFaces,
    textureSize: record.tileSize, rigJoints: record.template.rig.length,
  }));
} finally {
  if (tempSource) rmSync(tempSource, { recursive: true, force: true });
}
