import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileCustomWorld, createBlankMap, createFromBuiltinMap,
  exportCustomMapJSON, importCustomMapJSON, symmetryPoints, validateCustomMap,
} from '../src/game/custom-maps.js';
import { ELEVATION_LEVELS, heightAt } from '../src/game/terrain-height.js';
import { registerCustomWorld, unregisterCustomWorld } from '../src/game/world.js';
import { Engine } from '../src/game/engine.js';
import { TILE } from '../src/game/pathfinding.js';

test('symmetryPoints produces exact mirrored and rotational coordinates', () => {
  const extent = 4096, p = { x: 1000, y: 1200 };
  assert.equal(symmetryPoints(p, extent, 'none').length, 1);
  assert.deepEqual(symmetryPoints(p, extent, 'rotational'), [p, { x: 3096, y: 2896 }]);
  assert.equal(symmetryPoints(p, extent, 'quad').length, 4);
});

test('custom maps serialize, deserialize, validate, and run inside Engine cleanly', () => {
  const doc = createBlankMap('测试高地', 64);
  const stride = doc.size + 1;
  // Paint a central highland plateau
  for (let vz = 24; vz <= 40; vz++) for (let vx = 24; vx <= 40; vx++) {
    doc.heights[vz * stride + vx] = ELEVATION_LEVELS[1];
  }
  const issues = validateCustomMap(doc);
  assert.equal(issues.filter(i => i.severity === 'error').length, 0);

  const json = exportCustomMapJSON(doc);
  const restored = importCustomMapJSON(json);
  assert.equal(restored.id, doc.id);
  assert.equal(restored.name, '测试高地');
  assert.equal(restored.size, 64);
  const world = compileCustomWorld(restored);
  assert.equal(heightAt(world, 32 * TILE, 32 * TILE), ELEVATION_LEVELS[1]);

  registerCustomWorld(world);
  try {
    const engine = new Engine([{ name: 'A', ai: false }, { name: 'B', ai: true }], 'normal', world.id);
    for (let i = 0; i < 20; i++) engine.step(.05);
    assert.equal(engine.state.units.filter(u => u.kind === 'base').length, 2);
  } finally {
    unregisterCustomWorld(world.id);
  }
});

test('validateCustomMap catches disconnected bases and waterlogged deposits', () => {
  const doc = createBlankMap('断路测试', 64);
  // Cut map in half with an impassable water channel
  for (let y = 0; y < doc.size; y++) for (let x = 30; x <= 34; x++) doc.water[y * doc.size + x] = 1;
  const issues = validateCustomMap(doc);
  assert.ok(issues.some(i => i.severity === 'error' && /不连通/.test(i.message)));

  const fromBuiltin = createFromBuiltinMap('shattered-highlands');
  assert.equal(validateCustomMap(fromBuiltin).filter(i => i.severity === 'error').length, 0);
});
