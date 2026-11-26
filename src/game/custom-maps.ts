import { gridSize, TILE } from './pathfinding.js';
import { isMapId, mapInfo, type MapId } from './maps.js';
import { RESOURCE_STOCK } from './resource-world.js';
import { isFlatForBuilding, recomputeTerrainMasks, heightAt } from './terrain-height.js';
import { getWorld, registerCustomWorld, unregisterCustomWorld, type Feature, type WorldData } from './world.js';
import type { Point, ResourceNode, Side } from './types.js';

export const CUSTOM_MAP_PREFIX = 'custom:';
export const CUSTOM_MAPS_STORAGE_KEY = 'fudancraft-custom-maps-v1';
export type SymmetryMode = 'none' | 'horizontal' | 'vertical' | 'rotational' | 'quad';

export const MAP_SIZE_PRESETS = [
  { size: 64, label: '64×64 · 小型' },
  { size: 96, label: '96×96 · 中型' },
  { size: 128, label: '128×128 · 标准' },
  { size: 160, label: '160×160 · 大型' },
  { size: 192, label: '192×192 · 超大' },
] as const;

export interface CustomDeposit {
  x: number;
  y: number;
  kind: 'gold' | 'oil';
  amount: number;
  startSide?: Side;
}

export interface CustomMapDocument {
  version: 1;
  id: string;
  name: string;
  description: string;
  size: number;
  maxPlayers: number;
  heights: Float32Array;
  roads: Uint8Array;
  water: Uint8Array;
  ramps: Uint8Array;
  features: Feature[];
  bases: (Point & { side: Side })[];
  towers: (Point & { side: Side })[];
  deposits: CustomDeposit[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  point?: Point;
}

export const isCustomMapId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(CUSTOM_MAP_PREFIX) && id.length > CUSTOM_MAP_PREFIX.length;

export function symmetryPoints(p: Point, extent: number, mode: SymmetryMode): Point[] {
  const dedup = (pts: Point[]) => {
    const out: Point[] = [];
    for (const pt of pts) {
      if (!out.some(o => Math.hypot(o.x - pt.x, o.y - pt.y) < 1)) out.push(pt);
    }
    return out;
  };
  switch (mode) {
    case 'horizontal': return dedup([p, { x: extent - p.x, y: p.y }]);
    case 'vertical': return dedup([p, { x: p.x, y: extent - p.y }]);
    case 'rotational': return dedup([p, { x: extent - p.x, y: extent - p.y }]);
    case 'quad': return dedup([p, { x: extent - p.x, y: p.y }, { x: p.x, y: extent - p.y }, { x: extent - p.x, y: extent - p.y }]);
    default: return [p];
  }
}

export function createBlankMap(name = '新建 3D 战场', size = 128): CustomMapDocument {
  const extent = size * TILE, stride = size + 1;
  const id = `${CUSTOM_MAP_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const pad = Math.round(size * .17) * TILE + 16;
  const bases: (Point & { side: Side })[] = [
    { x: pad, y: extent - pad, side: 1 },
    { x: extent - pad, y: pad, side: 2 },
  ];
  const deposits: CustomDeposit[] = [
    { x: pad + 352, y: extent - pad, kind: 'gold', amount: RESOURCE_STOCK.mainGold, startSide: 1 },
    { x: pad + 320, y: extent - pad - 288, kind: 'oil', amount: RESOURCE_STOCK.mainOil, startSide: 1 },
    { x: extent - pad - 352, y: pad, kind: 'gold', amount: RESOURCE_STOCK.mainGold, startSide: 2 },
    { x: extent - pad - 320, y: pad + 288, kind: 'oil', amount: RESOURCE_STOCK.mainOil, startSide: 2 },
  ];
  return {
    version: 1,
    id,
    name,
    description: '由 3D 地图编辑器创建的自定义战场。',
    size,
    maxPlayers: 2,
    heights: new Float32Array(stride * stride),
    roads: new Uint8Array(size * size),
    water: new Uint8Array(size * size),
    ramps: new Uint8Array(size * size),
    features: [],
    bases,
    towers: [],
    deposits,
  };
}

/** 居中裁切或扩展自定义地图尺寸，保留中心区域已有地形、水体、道路与实体。 */
export function resizeCustomMap(doc: CustomMapDocument, targetSize: number): {
  doc: CustomMapDocument;
  worldOffset: number;
  trimmedCount: number;
  clampedBases: number;
} {
  const newSize = Math.max(48, Math.min(192, Math.round(targetSize)));
  if (newSize === doc.size) {
    return {
      doc: {
        ...doc,
        heights: new Float32Array(doc.heights),
        roads: new Uint8Array(doc.roads),
        water: new Uint8Array(doc.water),
        ramps: new Uint8Array(doc.ramps),
        features: doc.features.map(f => ({ ...f })),
        bases: doc.bases.map(b => ({ ...b })),
        towers: doc.towers.map(t => ({ ...t })),
        deposits: doc.deposits.map(d => ({ ...d })),
      },
      worldOffset: 0,
      trimmedCount: 0,
      clampedBases: 0,
    };
  }

  const oldSize = doc.size;
  const oldStride = oldSize + 1;
  const newStride = newSize + 1;
  const tileOffset = Math.round((newSize - oldSize) / 2);
  const worldOffset = tileOffset * TILE;

  const heights = new Float32Array(newStride * newStride);
  for (let nz = 0; nz < newStride; nz++) {
    const oz = nz - tileOffset;
    if (oz < 0 || oz >= oldStride) continue;
    for (let nx = 0; nx < newStride; nx++) {
      const ox = nx - tileOffset;
      if (ox < 0 || ox >= oldStride) continue;
      heights[nz * newStride + nx] = doc.heights[oz * oldStride + ox];
    }
  }

  const roads = new Uint8Array(newSize * newSize);
  const water = new Uint8Array(newSize * newSize);
  const ramps = new Uint8Array(newSize * newSize);
  for (let ny = 0; ny < newSize; ny++) {
    const oy = ny - tileOffset;
    if (oy < 0 || oy >= oldSize) continue;
    for (let nx = 0; nx < newSize; nx++) {
      const ox = nx - tileOffset;
      if (ox < 0 || ox >= oldSize) continue;
      const ni = ny * newSize + nx;
      const oi = oy * oldSize + ox;
      roads[ni] = doc.roads[oi];
      water[ni] = doc.water[oi];
      ramps[ni] = doc.ramps[oi];
    }
  }

  const minCoord = 2 * TILE;
  const maxCoord = (newSize - 2) * TILE;
  const inBounds = (x: number, y: number) => x >= minCoord && x <= maxCoord && y >= minCoord && y <= maxCoord;

  let trimmedCount = 0;
  const features: Feature[] = [];
  for (const f of doc.features) {
    const x = f.x + worldOffset, y = f.y + worldOffset;
    if (inBounds(x, y)) features.push({ ...f, x, y });
    else trimmedCount++;
  }
  const towers: (Point & { side: Side })[] = [];
  for (const t of doc.towers) {
    const x = t.x + worldOffset, y = t.y + worldOffset;
    if (inBounds(x, y)) towers.push({ ...t, x, y });
    else trimmedCount++;
  }
  const deposits: CustomDeposit[] = [];
  for (const d of doc.deposits) {
    const x = d.x + worldOffset, y = d.y + worldOffset;
    if (inBounds(x, y)) deposits.push({ ...d, x, y });
    else trimmedCount++;
  }

  const baseMin = 4 * TILE + TILE * .5;
  const baseMax = (newSize - 5) * TILE + TILE * .5;
  const snapTileCenter = (v: number) => (Math.floor(v / TILE) + .5) * TILE;
  let clampedBases = 0;
  const bases: (Point & { side: Side })[] = doc.bases.map(b => {
    const rx = b.x + worldOffset, ry = b.y + worldOffset;
    const cx = Math.max(baseMin, Math.min(baseMax, rx));
    const cy = Math.max(baseMin, Math.min(baseMax, ry));
    if (cx !== rx || cy !== ry) {
      clampedBases++;
      return { ...b, x: snapTileCenter(cx), y: snapTileCenter(cy) };
    }
    return { ...b, x: rx, y: ry };
  });

  return {
    doc: {
      ...doc,
      size: newSize,
      heights,
      roads,
      water,
      ramps,
      features,
      bases,
      towers,
      deposits,
    },
    worldOffset,
    trimmedCount,
    clampedBases,
  };
}

export function createFromBuiltinMap(mapId: MapId, customName?: string): CustomMapDocument {
  const world = getWorld(mapId);
  const size = gridSize(world.land), stride = size + 1;
  const heights = world.heights ? new Float32Array(world.heights) : new Float32Array(stride * stride);
  const roads = new Uint8Array(world.roads);
  const water = world.waterMask ? new Uint8Array(world.waterMask) : new Uint8Array(size * size);
  const ramps = world.ramps ? new Uint8Array(world.ramps) : new Uint8Array(size * size);
  if (!world.waterMask) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (heightAt({ land: world.land, heights }, (x + .5) * TILE, (y + .5) * TILE) < -1.5) water[y * size + x] = 1;
    }
  }
  const features = world.features.filter(f => f.kind !== 'water').map(f => ({ ...f }));
  const deposits: CustomDeposit[] = (world.deposits ?? [])
    .filter((d): d is ResourceNode & { kind: 'gold' | 'oil' } => d.tree === undefined && (d.kind === 'gold' || d.kind === 'oil'))
    .map(d => ({ x: d.x, y: d.y, kind: d.kind, amount: d.amount, ...(d.startSide ? { startSide: d.startSide } : {}) }));
  const id = `${CUSTOM_MAP_PREFIX}${mapId}-${Date.now().toString(36).slice(-4)}`;
  return {
    version: 1,
    id,
    name: customName ?? `${mapInfo(mapId).name} · 改`,
    description: `基于${mapInfo(mapId).name}编辑的自定义 3D 战场。`,
    size,
    maxPlayers: Math.max(2, Math.min(4, world.bases.length)),
    heights,
    roads,
    water,
    ramps,
    features,
    bases: world.bases.map(b => ({ ...b })),
    towers: world.towers.map(t => ({ ...t })),
    deposits,
  };
}

const isTreeKind = (kind: Feature['kind']) => kind === 'pine' || kind === 'oak' || kind === 'birch';

export function compileCustomWorld(doc: CustomMapDocument): WorldData {
  const size = doc.size;
  const baseObstacles = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 || doc.water[i]) baseObstacles[i] = 1;
  }
  for (const f of doc.features) {
    if (f.kind === 'rock' || f.kind === 'rockLarge' || f.kind === 'ruin') {
      const cx = Math.floor(f.x / TILE), cy = Math.floor(f.y / TILE);
      const r = f.kind === 'rockLarge' || f.kind === 'ruin' ? 1 : 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) baseObstacles[ny * size + nx] = 1;
      }
    }
  }
  const { cliffs, land } = recomputeTerrainMasks(doc.heights, baseObstacles, doc.ramps, size);
  const permanentLand = new Uint8Array(land);
  const treeTiles = new Map<number, number[]>();
  const deposits: ResourceNode[] = [];
  let nextId = 1;
  for (const d of doc.deposits) {
    deposits.push({
      id: nextId++,
      x: d.x,
      y: d.y,
      kind: d.kind,
      amount: d.amount,
      max: d.amount,
      radius: d.kind === 'oil' ? 35 : 33,
      ...(d.startSide ? { startSide: d.startSide } : {}),
    });
  }
  doc.features.forEach((f, treeIndex) => {
    if (!isTreeKind(f.kind)) return;
    const cx = Math.floor(f.x / TILE), cy = Math.floor(f.y / TILE);
    if (cx < 2 || cy < 2 || cx >= size - 2 || cy >= size - 2 || permanentLand[cy * size + cx]) return;
    const tile = cy * size + cx;
    land[tile] = 1;
    const list = treeTiles.get(tile) ?? [];
    list.push(nextId);
    treeTiles.set(tile, list);
    deposits.push({
      id: nextId++,
      x: f.x,
      y: f.y,
      kind: 'wood',
      amount: RESOURCE_STOCK.tree,
      max: RESOURCE_STOCK.tree,
      radius: 26,
      tree: treeIndex,
    });
  });

  return {
    id: doc.id,
    revision: 1,
    land,
    roads: new Uint8Array(doc.roads),
    features: doc.features.map(f => ({ ...f })),
    bases: doc.bases.map(b => ({ ...b })),
    towers: doc.towers.map(t => ({ ...t })),
    resources: [],
    deposits,
    treeTiles,
    permanentLand,
    heights: new Float32Array(doc.heights),
    ramps: new Uint8Array(doc.ramps),
    cliffs,
    waterMask: new Uint8Array(doc.water),
    customName: doc.name,
    customDocument: serializeCustomMap(doc),
  };
}

export function validateCustomMap(doc: CustomMapDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const world = compileCustomWorld(doc);
  const size = doc.size;
  if (doc.bases.length < 2) {
    issues.push({ severity: 'error', message: '至少需要放置 2 个不同阵营的基地出生点' });
    return issues;
  }
  const sides = new Set(doc.bases.map(b => b.side));
  if (sides.size !== doc.bases.length) {
    issues.push({ severity: 'error', message: '存在重复阵营编号的基地出生点' });
  }
  const tileAt = (p: Point) => Math.floor(p.y / TILE) * size + Math.floor(p.x / TILE);
  for (const base of doc.bases) {
    const cx = Math.floor(base.x / TILE), cy = Math.floor(base.y / TILE);
    const cells: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push({ x: cx + dx, y: cy + dy });
    if (cells.some(c => c.x < 2 || c.y < 2 || c.x >= size - 2 || c.y >= size - 2 || world.permanentLand![c.y * size + c.x])) {
      issues.push({ severity: 'error', message: `阵营 ${base.side} 基地位于水体、悬崖或边界阻挡区`, point: base });
    } else if (!isFlatForBuilding(world, cells)) {
      issues.push({ severity: 'error', message: `阵营 ${base.side} 基地所在地面不够平整`, point: base });
    }
  }
  // BFS 连通性校验
  const start = tileAt(doc.bases[0]);
  const visited = new Uint8Array(size * size);
  const queue: number[] = [];
  if (start >= 0 && start < visited.length && !world.permanentLand![start]) {
    visited[start] = 1;
    queue.push(start);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head], x = cur % size, y = Math.floor(cur / size);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (visited[ni] || world.permanentLand![ni]) continue;
      visited[ni] = 1;
      queue.push(ni);
    }
  }
  for (const base of doc.bases.slice(1)) {
    if (!visited[tileAt(base)]) {
      issues.push({ severity: 'error', message: `阵营 ${base.side} 基地与阵营 1 基地陆路不连通（请添加斜坡或打通道路）`, point: base });
    }
  }
  const hasGold = doc.deposits.some(d => d.kind === 'gold');
  if (!hasGold) issues.push({ severity: 'warning', message: '地图中尚未放置金矿' });
  for (const dep of doc.deposits) {
    const ti = tileAt(dep);
    if (ti < 0 || ti >= visited.length || world.permanentLand![ti]) {
      issues.push({ severity: 'error', message: `${dep.kind === 'gold' ? '金矿' : '石油点'}落在水体或不可通行悬崖上`, point: dep });
    } else if (!visited[ti]) {
      issues.push({ severity: 'warning', message: `${dep.kind === 'gold' ? '金矿' : '石油点'}无法从主基地陆路到达`, point: dep });
    }
  }
  return issues;
}

function bytesToBase64(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw);
}
function base64ToBytes(encoded: string): Uint8Array {
  const raw = atob(encoded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SerializedCustomMap {
  version: 1;
  id: string;
  name: string;
  description: string;
  size: number;
  maxPlayers: number;
  heightsB64: string;
  roadsB64: string;
  waterB64: string;
  rampsB64: string;
  features: Feature[];
  bases: (Point & { side: Side })[];
  towers: (Point & { side: Side })[];
  deposits: CustomDeposit[];
}

export function serializeCustomMap(doc: CustomMapDocument): SerializedCustomMap {
  const q = new Int16Array(doc.heights.length);
  for (let i = 0; i < doc.heights.length; i++) q[i] = Math.max(-32000, Math.min(32000, Math.round(doc.heights[i] * 4)));
  return {
    version: 1,
    id: doc.id,
    name: doc.name.trim().slice(0, 32) || '自定义战场',
    description: doc.description.trim().slice(0, 120) || '自定义 3D 战场',
    size: doc.size,
    maxPlayers: Math.max(2, Math.min(4, doc.bases.length || doc.maxPlayers)),
    heightsB64: bytesToBase64(new Uint8Array(q.buffer)),
    roadsB64: bytesToBase64(doc.roads),
    waterB64: bytesToBase64(doc.water),
    rampsB64: bytesToBase64(doc.ramps),
    features: doc.features,
    bases: doc.bases,
    towers: doc.towers,
    deposits: doc.deposits,
  };
}

export function deserializeCustomMap(raw: unknown): CustomMapDocument {
  const data = raw as Partial<SerializedCustomMap>;
  if (!data || data.version !== 1 || typeof data.id !== 'string' || !data.id.startsWith(CUSTOM_MAP_PREFIX)) {
    throw Error('无效的自定义地图格式');
  }
  const size = data.size;
  if (!Number.isInteger(size) || size! < 48 || size! > 192) throw Error('地图尺寸不受支持');
  const stride = size! + 1, cellCount = size! * size!;
  const hBytes = base64ToBytes(String(data.heightsB64 ?? ''));
  if (hBytes.byteLength !== stride * stride * 2) throw Error('高度场数据长度不匹配');
  const q = new Int16Array(hBytes.buffer, hBytes.byteOffset, stride * stride);
  const heights = new Float32Array(stride * stride);
  for (let i = 0; i < heights.length; i++) heights[i] = q[i] / 4;
  const roads = base64ToBytes(String(data.roadsB64 ?? ''));
  const water = base64ToBytes(String(data.waterB64 ?? ''));
  const ramps = base64ToBytes(String(data.rampsB64 ?? ''));
  if (roads.length !== cellCount || water.length !== cellCount || ramps.length !== cellCount) {
    throw Error('地形掩码数据长度不匹配');
  }
  return {
    version: 1,
    id: data.id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 32) : '自定义战场',
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 120) : '自定义 3D 战场',
    size: size!,
    maxPlayers: Math.max(2, Math.min(4, Array.isArray(data.bases) ? data.bases.length : 2)),
    heights,
    roads,
    water,
    ramps,
    features: Array.isArray(data.features) ? data.features : [],
    bases: Array.isArray(data.bases) ? data.bases : [],
    towers: Array.isArray(data.towers) ? data.towers : [],
    deposits: Array.isArray(data.deposits) ? data.deposits : [],
  };
}

export function exportCustomMapJSON(doc: CustomMapDocument): string {
  return JSON.stringify(serializeCustomMap(doc), null, 2);
}

export function importCustomMapJSON(text: string): CustomMapDocument {
  return deserializeCustomMap(JSON.parse(text));
}

export function listCustomMaps(): CustomMapDocument[] {
  try {
    const raw = localStorage.getItem(CUSTOM_MAPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const docs: CustomMapDocument[] = [];
    for (const item of parsed) {
      try { docs.push(deserializeCustomMap(item)); } catch { /* skip corrupt entry */ }
    }
    return docs;
  } catch {
    return [];
  }
}

export function saveCustomMap(doc: CustomMapDocument): void {
  const existing = listCustomMaps().filter(m => m.id !== doc.id);
  existing.unshift(doc);
  localStorage.setItem(CUSTOM_MAPS_STORAGE_KEY, JSON.stringify(existing.map(serializeCustomMap)));
  registerCustomWorld(compileCustomWorld(doc));
}

export function deleteCustomMap(id: string): void {
  const remaining = listCustomMaps().filter(m => m.id !== id);
  localStorage.setItem(CUSTOM_MAPS_STORAGE_KEY, JSON.stringify(remaining.map(serializeCustomMap)));
  unregisterCustomWorld(id);
}

export function syncCustomWorlds(): CustomMapDocument[] {
  const docs = listCustomMaps();
  for (const doc of docs) registerCustomWorld(compileCustomWorld(doc));
  return docs;
}

export function customMapSupportsPlayers(id: string, count: number): boolean {
  if (isMapId(id)) return false;
  const doc = listCustomMaps().find(m => m.id === id);
  return !!doc && Number.isInteger(count) && count >= 2 && count <= doc.maxPlayers;
}
