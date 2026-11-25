import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/game/camera.js';
import { MAPS } from '../src/game/maps.js';
import { getWorld } from '../src/game/world.js';
import { TILE } from '../src/game/pathfinding.js';
import {
  CLIFF_STEP, ELEVATION_LEVELS, heightAt, isFlatForBuilding, normalAt, recomputeTerrainMasks,
} from '../src/game/terrain-height.js';
import { Engine } from '../src/game/engine.js';

test('bilinear heightAt and normalAt evaluate smooth slopes and cliffs accurately', () => {
  const size = 16, stride = size + 1;
  const land = new Uint8Array(size * size);
  const heights = new Float32Array(stride * stride);
  const ramps = new Uint8Array(size * size);
  for (let z = 0; z < stride; z++) for (let x = 0; x < stride; x++) {
    heights[z * stride + x] = x >= 8 ? ELEVATION_LEVELS[1] : 0;
  }
  const world = { land, heights };
  assert.equal(heightAt(world, 2 * TILE, 5 * TILE), 0);
  assert.equal(heightAt(world, 10 * TILE, 5 * TILE), ELEVATION_LEVELS[1]);
  assert.equal(heightAt(world, 7.5 * TILE, 5 * TILE), ELEVATION_LEVELS[1] / 2);
  const [nx, ny, nz] = normalAt(world, 7.5 * TILE, 5 * TILE);
  assert.ok(nx < -.3 && ny > .5 && Math.abs(nz) < 1e-6, 'slope normal points downhill (-X) and upward (+Y)');

  const { cliffs, land: blocked } = recomputeTerrainMasks(heights, land, ramps, size);
  assert.equal(cliffs[5 * size + 7], 1, 'steep un-ramped drop becomes an impassable cliff');
  assert.equal(blocked[5 * size + 7], 1);
  assert.equal(isFlatForBuilding({ land: blocked, heights, ramps, cliffs }, [{ x: 7, y: 5 }]), false);
  assert.equal(isFlatForBuilding({ land: blocked, heights, ramps, cliffs }, [{ x: 10, y: 5 }, { x: 11, y: 5 }]), true);

  // Marking tile (7,5) as a ramp makes it passable while still disallowing building placement
  ramps[5 * size + 7] = 1;
  const withRamp = recomputeTerrainMasks(heights, land, ramps, size);
  assert.equal(withRamp.cliffs[5 * size + 7], 0);
  assert.equal(withRamp.land[5 * size + 7], 0);
  assert.equal(isFlatForBuilding({ land: withRamp.land, heights, ramps, cliffs: withRamp.cliffs }, [{ x: 7, y: 5 }]), false);
  assert.ok(ELEVATION_LEVELS[1] > CLIFF_STEP);
});

test('Camera.screenToTerrain inverts worldToScreen on elevated plateaus without parallax drift', () => {
  const cam = new Camera(4096);
  cam.resize(1280, 720);
  cam.orient(Math.PI / 6, .74, 320);
  cam.focus({ x: 2048, y: 2048 });
  const plateau = (x: number, z: number) => (Math.hypot(x - 2048, z - 2048) < 420 ? 26 : 0);
  const target = { x: 2120, y: 1960 };
  const projected = cam.worldToScreen(target, plateau(target.x, target.y));
  const picked = cam.screenToTerrain(projected, plateau);
  assert.ok(Math.hypot(picked.x - target.x, picked.y - target.y) < .35,
    `3D terrain pick drift too large: (${picked.x}, ${picked.y}) vs (${target.x}, ${target.y})`);
});

test('all 8 built-in latest map revisions provide finite 3D heightfields with flat base aprons', () => {
  for (const map of MAPS) {
    const world = getWorld(map.id);
    assert.ok(world.heights instanceof Float32Array, `${map.id} missing heightfield`);
    let maxH = -Infinity, minH = Infinity;
    for (const h of world.heights) {
      assert.ok(Number.isFinite(h));
      if (h > maxH) maxH = h;
      if (h < minH) minH = h;
    }
    assert.ok(maxH >= ELEVATION_LEVELS[1] - 1, `${map.id} should contain elevated terrain`);
    const engine = new Engine(
      Array.from({ length: map.maxPlayers }, (_, i) => ({ name: `P${i + 1}`, ai: false })),
      'normal',
      map.id,
    );
    for (const base of world.bases) {
      const spot = engine.findBuildSpot(base.side, 'powerplant', base, engine.visible.get(base.side));
      assert.ok(spot, `${map.id} side ${base.side} has no flat build spot near base`);
    }
  }
});
