import { registerMapSnapshot, validateMapSnapshot, type MapSnapshot, type MapVersion } from './map-versions.js';

const memory = new Map<string, MapSnapshot>();
const key = (v: MapVersion) => `${v.mapId}@${v.contentHash}`;
let database: Promise<IDBDatabase | null> | undefined;
function db(): Promise<IDBDatabase | null> {
  return database ??= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const request = indexedDB.open('fudancraft-map-versions-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('versions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
export async function cachedMapVersion(version: MapVersion): Promise<MapSnapshot | null> {
  let raw: unknown = memory.get(key(version));
  if (!raw) {
    const database = await db();
    if (database) raw = await new Promise(resolve => {
      const request = database.transaction('versions').objectStore('versions').get(key(version));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  if (!raw) return null;
  try {
    const snapshot = validateMapSnapshot(raw);
    if (JSON.stringify(snapshot.version) !== JSON.stringify(version)) return null;
    return registerMapSnapshot(snapshot);
  } catch { return null; }
}
/** 不写入编辑器草稿存储：同名地图的旧版本与下载版本互不覆盖。 */
export async function cacheMapVersion(raw: MapSnapshot): Promise<boolean> {
  const snapshot = registerMapSnapshot(raw);
  memory.set(key(snapshot.version), snapshot);
  const database = await db();
  if (!database) return false;
  return new Promise(resolve => {
    try {
      const transaction = database.transaction('versions', 'readwrite');
      transaction.objectStore('versions').put(snapshot, key(snapshot.version));
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = transaction.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}
export async function listCachedMapVersions(): Promise<MapVersion[]> {
  const versions=new Map([...memory.values()].map(s=>[key(s.version),s.version]));
  const database=await db();
  if(database){
    const values:unknown[]=await new Promise(resolve=>{
      const request=database.transaction('versions').objectStore('versions').getAll();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve([]);
    });
    for(const raw of values){
      try{const s=validateMapSnapshot(raw);versions.set(key(s.version),s.version);}catch{/* 损坏缓存不会成为可选地图。 */}
    }
  }
  return [...versions.values()];
}
