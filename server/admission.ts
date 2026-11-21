import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';

export function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const addressKey = (address: string) => address.replace(/^::ffff:(?=\d)/i, '');
const proxies = new Set(
  (process.env.WS_TRUSTED_PROXIES ?? '').split(',').map(address => addressKey(address.trim())).filter(address => isIP(address)),
);
const origins = new Set((process.env.WS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));

export function clientAddress(request: IncomingMessage) {
  const peer = addressKey(request.socket.remoteAddress ?? '');
  const forwarded = request.headers['x-real-ip'];
  return proxies.has(peer) && typeof forwarded === 'string' && isIP(forwarded) ? addressKey(forwarded) : peer;
}

export function allowedOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origins.size) return origins.has(origin);
  return origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
}

export function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  const retry = status === 429 || status === 503 ? 'Retry-After: 5\r\n' : '';
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n${retry}\r\n`);
}
