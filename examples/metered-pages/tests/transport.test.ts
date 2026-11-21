import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { MeteredPeer, MeteredPeerOptions, RemotePeer } from '@metered-ca/realtime';
import { MeteredRoom, type PeerInfo } from '../src/metered-room';
import { decodePacket, MAX_BUFFER_BYTES, type Packet } from '../src/protocol';

class Channel {
  readyState = 'connecting';
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly label: string, readonly options?: RTCDataChannelInit) {}
  open() { this.readyState = 'open'; this.onopen?.(new Event('open')); }
  receive(packet: unknown) { this.onmessage?.({ data: JSON.stringify(packet) } as MessageEvent); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 'closed'; this.onclose?.(new Event('close')); }
}

class Remote extends EventEmitter {
  state = 'connecting';
  channels: Channel[] = [];
  pc = {
    connectionState: 'connecting',
    createDataChannel: (label: string, options: RTCDataChannelInit) => {
      const channel = new Channel(label, options);
      this.channels.push(channel);
      return channel as unknown as RTCDataChannel;
    },
  };
  constructor(readonly id: string, readonly polite: boolean) { super(); }
}

class Peer extends EventEmitter {
  joined: string | null = null;
  closed = false;
  async join(channel: string) { this.joined = channel; }
  async close() { this.closed = true; }
}

function harness(polite = false) {
  const peer = new Peer();
  const remote = new Remote('remote-1', polite);
  const packets: Packet[] = [];
  const infos: (PeerInfo | null)[] = [];
  let sdkOptions: MeteredPeerOptions | undefined;
  const room = new MeteredRoom({
    key: 'pk_live_example_only', name: '测试指挥官', relayOnly: true,
    onState() {}, onError() {},
    onPeer(info) { infos.push(info); },
    onPacket(_id, packet) { packets.push(packet); },
  }, options => {
    sdkOptions = options;
    return peer as unknown as MeteredPeer;
  });
  peer.emit('peer-joined', { peer: remote as unknown as RemotePeer });
  return { peer, remote, packets, infos, room, get sdkOptions() { return sdkOptions; } };
}

test('refuses malformed, oversized, incompatible and out-of-bounds peer packets', () => {
  for (const value of [
    null, new ArrayBuffer(4), '{broken', JSON.stringify({ v: 2, type: 'chat', text: 'hello' }),
    JSON.stringify({ v: 1, type: 'chat', text: ' ' }),
    JSON.stringify({ v: 1, type: 'hello', name: 'a'.repeat(25) }),
    JSON.stringify({ v: 1, type: 'position', seq: 1, x: -1, y: .5 }),
    JSON.stringify({ v: 1, type: 'position', seq: 1.5, x: .5, y: .5 }),
    JSON.stringify({ v: 1, type: 'position', seq: 1, x: null, y: .5 }),
    JSON.stringify({ v: 1, type: 'chat', text: '你'.repeat(2000) }),
  ]) assert.equal(decodePacket(value), null);
  assert.deepEqual(decodePacket('{"v":1,"type":"chat","text":"  你好  "}'), { v: 1, type: 'chat', text: '你好' });
});

test('creator starts negotiation before connected; preserves injected TURN config', async () => {
  const h = harness();
  try {
    assert.equal(h.remote.state, 'connecting');
    assert.equal(h.remote.channels.length, 2);
    assert.deepEqual(h.remote.channels[0].options, { ordered: true });
    assert.deepEqual(h.remote.channels[1].options, { ordered: false, maxRetransmits: 0 });
    await h.room.join('abcdef012345');
    assert.equal(h.peer.joined, 'fudancraft-pages-ABCDEF012345');
    const original = globalThis.RTCPeerConnection;
    let captured: RTCConfiguration | undefined;
    globalThis.RTCPeerConnection = class {
      constructor(config: RTCConfiguration) { captured = config; }
    } as unknown as typeof RTCPeerConnection;
    try {
      const iceServers = [{ urls: 'turn:example.invalid', username: 'temporary', credential: 'test' }];
      h.sdkOptions?.rtcPeerConnectionFactory?.({ iceServers });
      assert.deepEqual(captured, { iceServers, iceTransportPolicy: 'relay' });
    } finally { globalThis.RTCPeerConnection = original; }
  } finally { await h.room.close(); }
});

test('receiver does not create duplicate channels and handles both incoming channels', async () => {
  const h = harness(true);
  try {
    assert.equal(h.remote.channels.length, 0);
    for (const label of ['pages-control-v1', 'pages-updates-v1']) {
      const channel = new Channel(label);
      h.remote.emit('data-channel', { channel });
      channel.open();
    }
    assert.equal(h.infos.at(-1)?.ready, true);
  } finally { await h.room.close(); }
});

test('transport reset closes old handles, reopens both channels and discards late snapshots', async () => {
  const h = harness();
  try {
    const [control, updates] = h.remote.channels;
    control.open();
    updates.open();
    updates.receive({ v: 1, type: 'position', seq: 5, x: .4, y: .4 });
    updates.receive({ v: 1, type: 'position', seq: 4, x: .1, y: .1 });
    assert.equal(h.packets.length, 1);
    const staleCallback = updates.onmessage;
    h.remote.emit('connection-reset', {});
    assert.equal(control.readyState, 'closed');
    assert.equal(updates.onmessage, null);
    assert.equal(h.remote.channels.length, 4);
    staleCallback?.({ data: '{"v":1,"type":"position","seq":99,"x":0,"y":0}' } as MessageEvent);
    assert.equal(h.packets.length, 1);
    h.remote.channels[2].open();
    h.remote.channels[3].open();
    h.remote.channels[3].receive({ v: 1, type: 'position', seq: 0, x: .8, y: .8 });
    assert.equal(h.packets.length, 2);
    assert.equal(h.infos.at(-1)?.ready, true);
  } finally { await h.room.close(); }
});

test('backpressure drops snapshots and refuses chat without an unbounded queue', async () => {
  const h = harness();
  try {
    assert.throws(() => h.room.sendChat('hello'), /没有可发送/);
    const [control, updates] = h.remote.channels;
    control.open();
    updates.open();
    assert.equal(h.room.sendChat('hello'), 1);
    control.bufferedAmount = updates.bufferedAmount = MAX_BUFFER_BYTES;
    assert.equal(h.room.sendPosition(.5, .5), 0);
    assert.throws(() => h.room.sendChat('hello'), /没有可发送/);
    control.bufferedAmount = updates.bufferedAmount = 0;
    assert.equal(h.room.sendPosition(.5, .5), 1);
    h.peer.emit('peer-left', { peer: h.remote });
    assert.equal(updates.onmessage, null);
    assert.equal(h.room.sendPosition(.5, .5), 0);
    assert.equal(h.infos.at(-1), null);
  } finally { await h.room.close(); }
  assert.equal(h.peer.closed, true);
});
