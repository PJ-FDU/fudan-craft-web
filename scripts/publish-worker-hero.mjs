import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { removePackedModel } from './packed-models.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'public/assets/blender-sculpt-v2');
const artifact = resolve(root, 'artifacts/worker-hero');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJSON(resolve(directory, 'manifest.json'));
const record = readJSON(resolve(artifact, 'worker-bake.json'))[0];
const source = readJSON(resolve(root, '.cache/sculpt-source/source.json'));
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
assert.equal(record.scriptHash, hash('scripts/build-worker-hero.py'), 'Worker bake is stale');
for (const source of Object.values(record.textureSources ?? {})) {
  assert.equal(source.sha256, hash(source.file), `Worker texture source changed: ${source.file}`);
}
assert.equal(manifest.scriptHash, hash('scripts/build-sculpt-assets.py'), 'Common sculpt library is stale');
assert.deepEqual(record.template.rig, source.templates['industrial:worker'].rig, 'Worker rig changed');
assert.equal(record.template.surface, 'worker');
assert.ok(record.projection.uvPixels > 0 &&
  record.projection.missedProjectionPixels / record.projection.uvPixels <= .05);

const original = readFileSync(resolve(directory, 'industrial.glb'));
const industrial = removePackedModel(original, 'industrial:worker');
const originalRecords = readJSON(resolve(root, 'artifacts/blender-sculpt/industrial-bake.json'))
  .filter(item => item.key !== 'industrial:worker');
const atomicWrite = (path, bytes) => {
  writeFileSync(path + '.tmp', bytes);renameSync(path + '.tmp', path);
};
atomicWrite(resolve(directory, 'industrial.glb'), industrial);
for (const name of ['worker.glb', 'worker-albedo.png', 'worker-normal.png', 'worker-orm.png']) {
  copyFileSync(resolve(artifact, name), resolve(directory, name));
}
manifest.templates['industrial:worker'] = record.template;
manifest.surfaces.worker = {albedo: 'worker-albedo.png', normal: 'worker-normal.png', orm: 'worker-orm.png'};
manifest.packs = [...new Set([...manifest.packs.filter(path => path !== 'worker.glb'), 'worker.glb'])];
manifest.textures = [...new Set([...manifest.textures, ...Object.values(manifest.surfaces.worker)])];
manifest.generators ??= {};
for (const name of ['industrial', 'brood', 'stellar', 'relay']) manifest.generators[name] = {
  script: 'scripts/build-sculpt-assets.py', scriptHash: manifest.scriptHash,
  bake: `artifacts/blender-sculpt/${name}-bake.json`, blend: `artifacts/blender-sculpt/${name}.blend`,
};
manifest.generators.worker = {
  script: 'scripts/build-worker-hero.py', scriptHash: record.scriptHash,
  bake: 'artifacts/blender-sculpt/worker-bake.json', blend: 'artifacts/worker-hero/engineering-worker.blend',
};
atomicWrite(resolve(root, 'artifacts/blender-sculpt/industrial-bake.json'), JSON.stringify(originalRecords, null, 2) + '\n');
atomicWrite(resolve(root, 'artifacts/blender-sculpt/worker-bake.json'), JSON.stringify([record], null, 2) + '\n');
atomicWrite(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({
  key: record.key, scriptHash: record.scriptHash, industrialBytesBefore: original.length,
  industrialBytesAfter: industrial.length, workerBytes: readFileSync(resolve(directory, 'worker.glb')).length,
  textureSize: record.tileSize,
}));
