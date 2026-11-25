import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { removePackedModel } from './packed-models.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'public/assets/blender-sculpt-v2');
const artifact = resolve(root, 'artifacts/sniper-hero');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const manifest = readJSON(resolve(directory, 'manifest.json'));
const record = readJSON(resolve(artifact, 'sniper-bake.json'))[0];
const source = readJSON(resolve(process.argv[2], 'source.json'));
assert.equal(record.scriptHash, hash('scripts/build-sniper-hero.py'), 'Sniper bake is stale');
assert.equal(manifest.scriptHash, hash('scripts/build-sculpt-assets.py'), 'Common sculpt library is stale');
assert.deepEqual(record.template.rig, source.templates['industrial:sniper'].rig, 'Sniper rig changed');
assert.equal(record.template.surface, 'sniper');
assert.ok(record.projection.uvPixels > 0 &&
  record.projection.missedProjectionPixels / record.projection.uvPixels <= .05);

const original = readFileSync(resolve(directory, 'industrial.glb'));
const industrial = removePackedModel(original, 'industrial:sniper');
const originalRecords = readJSON(resolve(root, 'artifacts/blender-sculpt/industrial-bake.json'))
  .filter(item => item.key !== 'industrial:sniper');
const atomicWrite = (path, bytes) => {
  writeFileSync(path + '.tmp', bytes);renameSync(path + '.tmp', path);
};
atomicWrite(resolve(directory, 'industrial.glb'), industrial);
for (const name of ['sniper.glb', 'sniper-albedo.png', 'sniper-normal.png', 'sniper-orm.png']) {
  copyFileSync(resolve(artifact, name), resolve(directory, name));
}
manifest.templates['industrial:sniper'] = record.template;
manifest.surfaces.sniper = {albedo: 'sniper-albedo.png', normal: 'sniper-normal.png', orm: 'sniper-orm.png'};
manifest.packs = [...new Set([...manifest.packs.filter(path => path !== 'sniper.glb'), 'sniper.glb'])];
manifest.textures = [...new Set([...manifest.textures, ...Object.values(manifest.surfaces.sniper)])];
manifest.generators ??= {};
manifest.generators.sniper = {
  script: 'scripts/build-sniper-hero.py', scriptHash: record.scriptHash,
  bake: 'artifacts/blender-sculpt/sniper-bake.json', blend: 'artifacts/sniper-hero/ghost-sniper.blend',
};
atomicWrite(resolve(root, 'artifacts/blender-sculpt/industrial-bake.json'), JSON.stringify(originalRecords, null, 2) + '\n');
atomicWrite(resolve(root, 'artifacts/blender-sculpt/sniper-bake.json'), JSON.stringify([record], null, 2) + '\n');
atomicWrite(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({
  key: record.key, scriptHash: record.scriptHash, industrialBytesBefore: original.length,
  industrialBytesAfter: industrial.length, sniperBytes: readFileSync(resolve(directory, 'sniper.glb')).length,
  textureSize: record.tileSize,
}));
