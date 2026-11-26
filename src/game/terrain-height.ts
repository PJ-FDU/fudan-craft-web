import { distanceToCurve, insidePolygon, terrainNoise, waterContour } from './terrain-shapes.js';
import { gridSize, TILE } from './grid.js';
import type { Point } from './types.js';
import type { WorldData } from './world.js';

export const ELEVATION_LEVELS = [0, 26, 52] as const;
export const WATER_SURFACE_Y = -1.5;
export const WATER_BED_DEPTH = -20;
export const CLIFF_STEP = 10;
export const FLAT_TOLERANCE = 3.2;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 双线性插值查询任意世界坐标 (x, z) 的地表高度；旧版平地地图返回 0。 */
export function heightAt(world: Pick<WorldData, 'land' | 'heights'>, x: number, z: number): number {
  const heights = world.heights;
  if (!heights) return 0;
  const size = gridSize(world.land), stride = size + 1;
  const gx = Math.max(0, Math.min(size, x / TILE));
  const gz = Math.max(0, Math.min(size, z / TILE));
  const x0 = Math.min(size - 1, Math.floor(gx)), z0 = Math.min(size - 1, Math.floor(gz));
  const tx = gx - x0, tz = gz - z0;
  const i00 = z0 * stride + x0;
  const h00 = heights[i00], h10 = heights[i00 + 1];
  const h01 = heights[i00 + stride], h11 = heights[i00 + stride + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

/** 中心差分计算地表单位法线，供载具坡度贴合与悬崖渲染使用。 */
export function normalAt(world: Pick<WorldData, 'land' | 'heights'>, x: number, z: number): readonly [number, number, number] {
  if (!world.heights) return [0, 1, 0];
  const eps = TILE * .5;
  const dhdx = (heightAt(world, x + eps, z) - heightAt(world, x - eps, z)) / (2 * eps);
  const dhdz = (heightAt(world, x, z + eps) - heightAt(world, x, z - eps)) / (2 * eps);
  const len = Math.hypot(dhdx, 1, dhdz) || 1;
  return [-dhdx / len, 1 / len, -dhdz / len];
}

export function tileHeightSpread(heights: Float32Array, size: number, cx: number, cz: number): number {
  const stride = size + 1;
  const i = cz * stride + cx;
  const a = heights[i], b = heights[i + 1], c = heights[i + stride], d = heights[i + stride + 1];
  return Math.max(a, b, c, d) - Math.min(a, b, c, d);
}

/** 校验建筑占地全部格子是否位于同一平整海拔层且不压在斜坡/陡崖上。 */
export function isFlatForBuilding(
  world: Pick<WorldData, 'land' | 'heights' | 'ramps' | 'cliffs'>,
  cells: readonly Point[],
): boolean {
  const heights = world.heights;
  if (!heights) return true;
  const size = gridSize(world.land), stride = size + 1;
  let minH = Infinity, maxH = -Infinity;
  for (const { x, y } of cells) {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const idx = y * size + x;
    if (world.cliffs?.[idx] || world.ramps?.[idx]) return false;
    const vi = y * stride + x;
    const h0 = heights[vi], h1 = heights[vi + 1], h2 = heights[vi + stride], h3 = heights[vi + stride + 1];
    minH = Math.min(minH, h0, h1, h2, h3);
    maxH = Math.max(maxH, h0, h1, h2, h3);
  }
  return maxH - minH <= FLAT_TOLERANCE;
}

/** 根据高度场、基础障碍掩码（水体/边缘/岩石）与斜坡掩码，推导陡崖与最终通行掩码。 */
export function recomputeTerrainMasks(
  heights: Float32Array,
  baseObstacles: Uint8Array,
  ramps: Uint8Array,
  size: number,
): { cliffs: Uint8Array; land: Uint8Array } {
  const cliffs = new Uint8Array(size * size);
  const land = new Uint8Array(baseObstacles);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (baseObstacles[i]) continue;
    const spread = tileHeightSpread(heights, size, x, y);
    if (spread > CLIFF_STEP && !ramps[i]) {
      cliffs[i] = 1;
      land[i] = 1;
    }
  }
  return { cliffs, land };
}

/** 为内置 8 张地图生成贴合地貌主题的真 3D 高度场，同时严格保持既有基地/矿区平整与通路可达。 */
export function applyBuiltinElevation(world: WorldData): WorldData {
  const size = gridSize(world.land), stride = size + 1, extent = size * TILE, center = extent / 2;
  const heights = new Float32Array(stride * stride);
  const ramps = new Uint8Array(size * size);
  const cliffs = new Uint8Array(size * size);
  const noise = terrainNoise(731);

  const waters = world.features.filter(f => f.kind === 'water').map(feature => {
    const contour = waterContour(feature);
    const ox = feature.x + (feature.waterRadii ? 0 : 16), oy = feature.y + (feature.waterRadii ? 0 : 16);
    return {
      ox, oy, contour, closed: [...contour, contour[0]],
      minX: Math.min(...contour.map(p => p.x)), maxX: Math.max(...contour.map(p => p.x)),
      minY: Math.min(...contour.map(p => p.y)), maxY: Math.max(...contour.map(p => p.y)),
    };
  });

  const plateauLevel = (x: number, z: number): number => {
    const dx = x - center, dz = z - center, r = Math.hypot(dx, dz);
    const scale = extent / 4096;
    switch (world.id) {
      case 'shattered-highlands': {
        // 基地台地一级高地，两条分隔岩脊跃升二级高地，中央山谷与隘口为低地。
        const basePlateau = world.bases.reduce((acc, b) => Math.max(acc, 1 - smoothstep(460 * scale, 690 * scale, Math.hypot(x - b.x, z - b.y))), 0);
        const ridgeX = Math.min(Math.abs(x - 1440 * scale), Math.abs(x - 2656 * scale));
        const inPass = [864, 2048, 3232].some(py => Math.abs(z - py * scale) < 250 * scale);
        const ridge = !inPass && z > 300 * scale && z < extent - 300 * scale
          ? (1 - smoothstep(140 * scale, 260 * scale, ridgeX)) * ELEVATION_LEVELS[2] : 0;
        return Math.max(basePlateau * ELEVATION_LEVELS[1], ridge);
      }
      case 'lost-temple': {
        // 中央神庙高台一级高地，四周通过宽缓斜坡衔接主干道。
        const temple = (1 - smoothstep(320 * scale, 560 * scale, r)) * ELEVATION_LEVELS[1];
        return temple;
      }
      case 'ring-valley': {
        // 外环与四角基地居高临下，中央山谷低洼。
        const rim = smoothstep(1060 * scale, 1340 * scale, r) * ELEVATION_LEVELS[1];
        return rim;
      }
      case 'twisted-meadows':
      case 'terenas-stand': {
        // 四角/对角出生台地高于中央河谷草地。
        const basePlateau = world.bases.reduce((acc, b) => Math.max(acc, 1 - smoothstep(480 * scale, 720 * scale, Math.hypot(x - b.x, z - b.y))), 0);
        return basePlateau * ELEVATION_LEVELS[1];
      }
      case 'turtle-rock':
      case 'echo-isles': {
        // 中央林地高台，海岸与外围略低。
        return (1 - smoothstep(380 * scale, 640 * scale, r)) * ELEVATION_LEVELS[1];
      }
      case 'twin-lakes': {
        // 东西侧翼高地，南北湖区与中央走廊低地。
        const wing = smoothstep(820 * scale, 1140 * scale, Math.abs(dx)) * (1 - smoothstep(1100 * scale, 1450 * scale, Math.abs(dz)));
        return wing * ELEVATION_LEVELS[1];
      }
      default: return 0;
    }
  };

  for (let vz = 0; vz < stride; vz++) for (let vx = 0; vx < stride; vx++) {
    const x = vx * TILE, z = vz * TILE;
    let h = 0, inWater = false;
    for (const water of waters) {
      const p = { x: x - water.ox, y: z - water.oy };
      if (p.x < water.minX || p.x > water.maxX || p.y < water.minY || p.y > water.maxY || !insidePolygon(p, water.contour)) continue;
      const depth = distanceToCurve(p, water.closed);
      h = Math.min(h, Math.max(WATER_BED_DEPTH, -depth * .38));
      inWater = true;
    }
    if (!inWater) {
      h = plateauLevel(x, z);
      // 不可通行林区/岩脊内部叠加柔和自然起伏，增强轮廓立体感。
      const cx = Math.min(size - 1, vx), cz = Math.min(size - 1, vz);
      if (cx > 1 && cz > 1 && cx < size - 2 && cz < size - 2) {
        let interior = true;
        for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!world.land[(cz + dy) * size + (cx + dx)]) { interior = false; break; }
        }
        if (interior) h += Math.max(0, noise(x / 93, z / 93)) * 11;
      }
    }
    heights[vz * stride + vx] = h;
  }

  // 将所有基地周边与矿点所在小平台强制压平到各自中心海拔，确保建筑和油井严丝合缝。
  const flattenPad = (cx: number, cz: number, flatRadius: number, blendRadius: number, targetHeight: number) => {
    const x0 = Math.max(0, Math.floor((cx - blendRadius) / TILE));
    const x1 = Math.min(size, Math.ceil((cx + blendRadius) / TILE));
    const z0 = Math.max(0, Math.floor((cz - blendRadius) / TILE));
    const z1 = Math.min(size, Math.ceil((cz + blendRadius) / TILE));
    for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
      const d = Math.hypot(vx * TILE - cx, vz * TILE - cz);
      if (d > blendRadius) continue;
      const idx = vz * stride + vx;
      if (heights[idx] < -1) continue; // 不填平水体
      const w = 1 - smoothstep(flatRadius, blendRadius, d);
      heights[idx] = heights[idx] * (1 - w) + targetHeight * w;
    }
  };
  for (const base of world.bases) {
    const snap = Math.round(plateauLevel(base.x, base.y) / ELEVATION_LEVELS[1]) * ELEVATION_LEVELS[1];
    flattenPad(base.x, base.y, 480, 660, snap);
  }
  for (const node of world.deposits ?? []) {
    if (node.tree !== undefined) continue;
    const raw = heightAt({ land: world.land, heights }, node.x, node.y);
    const snap = Math.round(Math.max(0, raw) / ELEVATION_LEVELS[1]) * ELEVATION_LEVELS[1];
    flattenPad(node.x, node.y, 108, 210, snap);
  }

  // 既有可通行格中存在坡度的区域标记为可通行斜坡；不可通行陡变标记为悬崖。
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const spread = tileHeightSpread(heights, size, x, y);
    if (!world.land[i] && spread > FLAT_TOLERANCE) ramps[i] = 1;
    else if (world.land[i] && spread > CLIFF_STEP) cliffs[i] = 1;
  }

  return { ...world, heights, ramps, cliffs };
}
