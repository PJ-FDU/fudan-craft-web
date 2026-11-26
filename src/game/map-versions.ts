import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { compileCustomWorld, deserializeCustomMap, isCustomMapId, serializeCustomMap, validateCustomMap, type CustomMapDocument, type SerializedCustomMap } from './custom-maps.js';
import { registerCustomWorld, getWorld } from './world.js';
import { TILE } from './pathfinding.js';
import { DEFAULT_MAP_ID, isMapId } from './maps.js';

export const MAX_MAP_BYTES = 2 * 1024 * 1024 - 4096;
export interface MapVersion {
  schemaVersion: 1;
  mapId: string;
  contentHash: string;
  name: string;
  maxPlayers: number;
  byteLength: number;
}
export interface MapSnapshot { version: MapVersion; document: SerializedCustomMap }
const encoder = new TextEncoder();
// 对象键顺序不参与版本定义；数组顺序参与（资源和装饰编号依赖顺序）。
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function validMapVersion(raw: unknown): raw is MapVersion {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as MapVersion;
  return v.schemaVersion === 1 && isCustomMapId(v.mapId) && v.mapId.length <= 128
    && typeof v.contentHash === 'string' && /^[a-f0-9]{64}$/.test(v.contentHash)
    && typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 32
    && Number.isInteger(v.maxPlayers) && v.maxPlayers >= 2 && v.maxPlayers <= 4
    && Number.isInteger(v.byteLength) && v.byteLength > 0 && v.byteLength <= MAX_MAP_BYTES;
}
function checkedDocument(raw: unknown): CustomMapDocument {
  if (!raw || typeof raw !== 'object' || encoder.encode(JSON.stringify(raw)).length > MAX_MAP_BYTES) throw Error('地图数据过大或格式无效');
  const d = raw as SerializedCustomMap;
  if (!isCustomMapId(d.id) || d.id.length > 128 || typeof d.name !== 'string' || d.name.length > 32
    || typeof d.description !== 'string' || d.description.length > 120) throw Error('地图元信息无效');
  for (const [key, limit] of [['features', 3000], ['bases', 4], ['towers', 128], ['deposits', 512]] as const) {
    if (!Array.isArray(d[key]) || d[key].length > limit) throw Error('地图实体数量无效');
  }
  const doc = deserializeCustomMap(d), extent = doc.size * TILE;
  const point = (p: {x: number;y: number}) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < extent && p.y < extent;
  const side = (s: unknown) => Number.isInteger(s) && Number(s) >= 1 && Number(s) <= doc.bases.length;
  const kinds = ['pine','oak','birch','bush','ruin','rock','rockLarge','water','grass','flower','stump','fern'];
  if (doc.bases.length < 2 || d.maxPlayers !== doc.bases.length
    || doc.bases.some(b => !point(b) || !side(b.side)) || new Set(doc.bases.map(b => b.side)).size !== doc.bases.length
    || doc.towers.some(t => !point(t) || !side(t.side))
    || doc.features.some(f => !point(f) || !kinds.includes(f.kind) || !Number.isFinite(f.size) || f.size <= 0 || f.size > extent
      || !Number.isInteger(f.cell) || f.cell < 0 || f.cell > 255 || typeof f.block !== 'boolean'
      || f.waterRadii !== undefined && (!Number.isFinite(f.waterRadii.x) || !Number.isFinite(f.waterRadii.y) || f.waterRadii.x <= 0 || f.waterRadii.y <= 0 || f.waterRadii.x > extent || f.waterRadii.y > extent)
      || f.outline !== undefined && (!Array.isArray(f.outline) || f.outline.length > 256 || f.outline.some(p => !point(p)))
      || f.river !== undefined && typeof f.river !== 'boolean')
    || doc.deposits.some(d => !point(d) || !['gold','oil'].includes(d.kind) || !Number.isFinite(d.amount) || d.amount <= 0 || d.amount > 10_000_000 || d.startSide !== undefined && !side(d.startSide))
    || doc.water.some(n => n > 1) || doc.ramps.some(n => n > 1)) throw Error('地图实体或地形数据无效');
  const errors = validateCustomMap(doc).filter(i => i.severity === 'error');
  if (errors.length) throw Error(errors[0].message);
  return doc;
}
export function createMapSnapshot(doc: CustomMapDocument): MapSnapshot {
  const document = JSON.parse(JSON.stringify(serializeCustomMap(doc))) as SerializedCustomMap;
  checkedDocument(document);
  const bytes = encoder.encode(canonical(document));
  if (bytes.length > MAX_MAP_BYTES) throw Error('地图数据过大');
  return {version: {schemaVersion: 1, mapId: document.id, contentHash: bytesToHex(sha256(bytes)), name: document.name, maxPlayers: document.maxPlayers, byteLength: bytes.length}, document};
}
export function validateMapSnapshot(raw: unknown): MapSnapshot {
  if (!raw || typeof raw !== 'object') throw Error('地图快照无效');
  const s = raw as MapSnapshot;
  if (!validMapVersion(s.version)) throw Error('地图版本无效');
  const snapshot = createMapSnapshot(checkedDocument(s.document));
  if (canonical(snapshot.version) !== canonical(s.version)) throw Error('地图版本指纹不匹配');
  return snapshot;
}
export function registerMapSnapshot(raw: MapSnapshot): MapSnapshot {
  const snapshot = validateMapSnapshot(raw);
  try { getWorld(snapshot.version.mapId, 1, snapshot.version.contentHash); }
  catch { registerCustomWorld(compileCustomWorld(deserializeCustomMap(snapshot.document)), snapshot.version.contentHash); }
  return snapshot;
}
export function resolveRoomMap(mapId: unknown = DEFAULT_MAP_ID, raw?: unknown): {mapId: string; mapSnapshot?: MapSnapshot} {
  if (isMapId(mapId)) {
    if (raw !== undefined) throw Error('内置战场不能携带自定义地图');
    return {mapId};
  }
  if(!isCustomMapId(mapId))throw Error('未知战场');
  const mapSnapshot = validateMapSnapshot(raw);
  if (mapSnapshot.version.mapId !== mapId) throw Error('地图编号不匹配');
  registerMapSnapshot(mapSnapshot);
  return {mapId: mapSnapshot.version.mapId, mapSnapshot};
}
