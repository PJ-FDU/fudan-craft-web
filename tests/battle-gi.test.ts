import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataTexture, RedFormat, ShaderChunk, Vector3, type WebGLRenderer } from 'three';
import { BattleGI, MAX_BATTLE_LIGHTS, type BattleDynamicLight } from '../src/game/battle-gi.js';

function fakeRenderer(supportsFloat = true): WebGLRenderer {
  return {
    extensions: { has: (name: string) => supportsFloat && name === 'EXT_color_buffer_float' },
    capabilities: { maxSamples: 4 },
  } as unknown as WebGLRenderer;
}

test('BattleGI supports all four lighting tiers, PCSS strengths, and dynamic light capping', () => {
  const fog = { value: new DataTexture(new Uint8Array(4), 2, 2, RedFormat) };
  const extent = { value: 2048 };
  const gi = new BattleGI(fakeRenderer(true), fog, extent);
  assert.equal(gi.supported, true);
  assert.equal(gi.quality, 'off');
  assert.equal(gi.pcssStrength, 0);

  gi.quality = 'balanced';
  assert.equal(gi.quality, 'balanced');
  assert.equal(gi.pcssStrength, 0.65);

  gi.quality = 'high';
  assert.equal(gi.quality, 'high');
  assert.equal(gi.pcssStrength, 1.0);

  gi.quality = 'cinematic';
  assert.equal(gi.quality, 'cinematic');
  assert.equal(gi.pcssStrength, 1.0);

  const lights: BattleDynamicLight[] = Array.from({ length: MAX_BATTLE_LIGHTS + 8 }, (_, i) => ({
    x: i * 10, y: 20, z: i * 12, radius: 120, r: 1, g: 0.6, b: 0.2, intensity: 1.5,
  }));
  assert.doesNotThrow(() => gi.setDynamicLights(lights, lights.length));
  assert.doesNotThrow(() => gi.setSunDirection(new Vector3(-598, 1150, -462)));
  assert.doesNotThrow(() => gi.resetHistory());

  gi.quality = 'off';
  assert.equal(gi.pcssStrength, 0);
  gi.dispose();
  fog.value.dispose();
});

test('BattleGI degrades cleanly to off when EXT_color_buffer_float is unavailable', () => {
  const fog = { value: new DataTexture(new Uint8Array(4), 2, 2, RedFormat) };
  const gi = new BattleGI(fakeRenderer(false), fog, { value: 2048 });
  assert.equal(gi.supported, false);
  gi.quality = 'cinematic';
  assert.equal(gi.quality, 'off');
  assert.equal(gi.pcssStrength, 0);
  gi.dispose();
  fog.value.dispose();
});

test('Three.js PCF shadow shader chunk contains the expected Vogel-disk anchor for PCSS', () => {
  assert.ok(
    ShaderChunk.shadowmap_pars_fragment.includes('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;'),
    'Three.js shadowmap_pars_fragment anchor changed',
  );
});
