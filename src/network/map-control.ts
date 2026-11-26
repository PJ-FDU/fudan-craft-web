import { MAX_COMPRESSED_BYTES, FRAME_BYTES } from './snapshot-codec.js';

/** 只有地图交换可使用大消息；普通操作保留原来的 16 KiB 上限。 */
export function validControl(text: string): boolean {
  const size = new TextEncoder().encode(text).length;
  if (size > MAX_COMPRESSED_BYTES) return false;
  const message = JSON.parse(text);
  return !!message && typeof message.type === 'string' && (size <= FRAME_BYTES || ['create', 'select-map', 'map-data'].includes(message.type));
}
