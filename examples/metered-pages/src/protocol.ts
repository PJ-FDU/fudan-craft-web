export const MAX_PACKET_BYTES = 4096;
export const MAX_BUFFER_BYTES = 64 * 1024;

export type Packet =
  | { v: 1; type: 'hello'; name: string }
  | { v: 1; type: 'chat'; text: string }
  | { v: 1; type: 'position'; seq: number; x: number; y: number };

export function validateKey(value: string): string {
  const key = value.trim();
  if (!/^pk_live_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('请填写 pk_live_ 开头的 Publishable key。');
  }
  return key;
}

export function normalizeRoom(value: string): string {
  const room = value.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(room)) throw new Error('房间码应为 12 位字母 A–F 或数字。');
  return room;
}

export function createRoom(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => n.toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

export function decodePacket(value: unknown): Packet | null {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_PACKET_BYTES) return null;
  let p: unknown;
  try { p = JSON.parse(value); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const item = p as Record<string, unknown>;
  if (item.v !== 1) return null;
  if (item.type === 'hello' && typeof item.name === 'string' && item.name.trim() && item.name.length <= 24) {
    return { v: 1, type: 'hello', name: item.name.trim() };
  }
  if (item.type === 'chat' && typeof item.text === 'string' && item.text.trim() && item.text.length <= 240) {
    return { v: 1, type: 'chat', text: item.text.trim() };
  }
  if (item.type === 'position' && Number.isSafeInteger(item.seq) && (item.seq as number) >= 0
    && typeof item.x === 'number' && Number.isFinite(item.x) && item.x >= 0 && item.x <= 1
    && typeof item.y === 'number' && Number.isFinite(item.y) && item.y >= 0 && item.y <= 1) {
    return { v: 1, type: 'position', seq: item.seq as number, x: item.x, y: item.y };
  }
  return null;
}
