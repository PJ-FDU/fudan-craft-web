import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileCustomWorld, createBlankMap, createFromBuiltinMap,
  exportCustomMapJSON, importCustomMapJSON, resizeCustomMap, symmetryPoints, validateCustomMap,
} from '../src/game/custom-maps.js';
import { ELEVATION_LEVELS, WATER_BED_DEPTH, WATER_SURFACE_Y, heightAt } from '../src/game/terrain-height.js';
import { waterMaskGeometry } from '../src/game/battle-terrain.js';
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

test('waterMaskGeometry uses recessed heightfield shoreline with smooth depth gradient', () => {
  const doc = createBlankMap('湖泊岸线测试', 32);
  const stride = doc.size + 1, cx = 16 * TILE, cz = 16 * TILE, rad = 4 * TILE;
  for (let vz = 0; vz < stride; vz++) for (let vx = 0; vx < stride; vx++) {
    const d = Math.hypot(vx * TILE - cx, vz * TILE - cz);
    if (d < rad) {
      const t = 1 - d / rad;
      doc.heights[vz * stride + vx] = WATER_BED_DEPTH * t * t * (3 - 2 * t);
    }
  }
  for (let y = 0; y < doc.size; y++) for (let x = 0; x < doc.size; x++) {
    if (heightAt({ land: doc.water, heights: doc.heights }, (x + .5) * TILE, (y + .5) * TILE) < WATER_SURFACE_Y) {
      doc.water[y * doc.size + x] = 1;
    }
  }
  const geo = waterMaskGeometry(doc.water, doc.size, doc.heights);
  assert.ok(geo, 'expected non-null water geometry');
  const pos = geo.getAttribute('position'), depth = geo.getAttribute('waterDepth');
  let maxDepth = 0, minDepth = Infinity;
  for (let i = 0; i < pos.count; i++) {
    assert.equal(pos.getY(i), WATER_SURFACE_Y);
    const d = depth.getX(i);
    if (d > maxDepth) maxDepth = d;
    if (d < minDepth) minDepth = d;
  }
  assert.equal(minDepth, 0, 'shoreline vertices should taper smoothly to zero depth');
  assert.ok(maxDepth > 40, `deep basin should have substantial depth, got ${maxDepth}`);
});

test('resizeCustomMap preserves centered terrain when expanding and cropping', () => {
  const doc = createBlankMap('缩放测试', 96);
  const stride = doc.size + 1;
  // Paint a highland peak and water tile at center (48, 48)
  doc.heights[48 * stride + 48] = ELEVATION_LEVELS[2];
  doc.water[48 * doc.size + 48] = 1;
  doc.features.push({ x: 48 * TILE, y: 48 * TILE, kind: 'rock', size: 60, cell: 4, block: true });
  doc.features.push({ x: 6 * TILE, y: 6 * TILE, kind: 'rock', size: 60, cell: 4, block: true });

  // Expand 96 -> 128 (+16 tiles offset)
  const expanded = resizeCustomMap(doc, 128);
  assert.equal(expanded.doc.size, 128);
  assert.equal(expanded.worldOffset, 16 * TILE);
  assert.equal(expanded.doc.heights[64 * 129 + 64], ELEVATION_LEVELS[2]);
  assert.equal(expanded.doc.water[64 * 128 + 64], 1);
  assert.equal(expanded.trimmedCount, 0);
  assert.equal(expanded.doc.features[0].x, 64 * TILE);

  // Crop 128 -> 64 (-32 tiles offset): center stays at (32, 32), corner rock gets trimmed, bases clamped safely
  const cropped = resizeCustomMap(expanded.doc, 64);
  assert.equal(cropped.doc.size, 64);
  assert.equal(cropped.doc.heights[32 * 65 + 32], ELEVATION_LEVELS[2]);
  assert.equal(cropped.doc.water[32 * 64 + 32], 1);
  assert.ok(cropped.trimmedCount >= 1, 'outer corner feature should be trimmed');
  assert.equal(cropped.doc.bases.length, 2);
  for (const b of cropped.doc.bases) {
    assert.ok(b.x >= 4 * TILE && b.x <= 60 * TILE && b.y >= 4 * TILE && b.y <= 60 * TILE);
  }
});
