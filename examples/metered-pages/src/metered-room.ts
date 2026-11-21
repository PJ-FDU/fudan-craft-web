import { MeteredPeer, type MeteredPeerOptions, type MeteredPeerState, type RemotePeer } from '@metered-ca/realtime';
import { decodePacket, MAX_BUFFER_BYTES, MAX_PACKET_BYTES, normalizeRoom, validateKey, type Packet } from './protocol';

export type PeerInfo = {
  id: string;
  name: string;
  state: string;
  route: 'unknown' | 'direct' | 'relay';
  rttMs: number | null;
  ready: boolean;
};

type Connection = {
  remote: RemotePeer;
  info: PeerInfo;
  control?: RTCDataChannel;
  updates?: RTCDataChannel;
  lastSequence: number;
};

type Options = {
  key: string;
  name: string;
  relayOnly: boolean;
  onState: (state: MeteredPeerState) => void;
  onPeer: (info: PeerInfo | null, id: string) => void;
  onPacket: (id: string, packet: Packet) => void;
  onError: (message: string) => void;
};

export type PeerFactory = (options: MeteredPeerOptions) => MeteredPeer;
const CONTROL = 'pages-control-v1';
const UPDATES = 'pages-updates-v1';

/** 只管理通信；游戏状态与 DOM 均留在调用方。 */
export class MeteredRoom {
  private readonly peer: MeteredPeer;
  private readonly connections = new Map<string, Connection>();
  private closed = false;
  private sequence = 0;
  private statsPending = false;
  private readonly statsTimer: ReturnType<typeof setInterval>;

  constructor(private readonly options: Options, factory: PeerFactory = opts => new MeteredPeer(opts)) {
    const key = validateKey(options.key);
    if (!options.name.trim() || options.name.length > 24) throw new Error('指挥官名称需要 1–24 个字符。');
    this.peer = factory({
      apiKey: key,
      // 保留 SDK 注入的 TURN 凭据，仅覆盖路径策略，便于实际验证 TURN。
      rtcPeerConnectionFactory: config => new RTCPeerConnection({
        ...config, iceTransportPolicy: options.relayOnly ? 'relay' : 'all',
      }),
    });
    this.peer.on('state-change', ({ to }) => {
      if (!this.closed) options.onState(to);
    });
    this.peer.on('error', ({ err }) => {
      if (!this.closed) options.onError(this.explainError(err));
    });
    this.peer.on('peer-joined', ({ peer: remote }) => this.attachPeer(remote));
    this.peer.on('peer-left', ({ peer: remote }) => this.removePeer(remote.id));
    this.statsTimer = setInterval(() => { void this.refreshStats(); }, 2000);
  }

  async join(room: string): Promise<void> {
    const channel = `fudancraft-pages-${normalizeRoom(room)}`;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.peer.join(channel),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('连接超时，请检查密钥、权限与网络。')), 30_000);
        }),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  sendChat(text: string): number {
    const packet = decodePacket(JSON.stringify({ v: 1, type: 'chat', text }));
    if (!packet || packet.type !== 'chat') throw new Error('消息需要 1–240 个字符。');
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (this.send(connection.control, packet)) sent++;
    }
    if (!sent) throw new Error('没有可发送的通道，请等待连接完成或缓冲区恢复。');
    return sent;
  }

  /** 位置快照可以丢弃；指令、聊天等必须走可靠 control 通道。 */
  sendPosition(x: number, y: number): number {
    const packet = decodePacket(JSON.stringify({ v: 1, type: 'position', seq: this.sequence++, x, y }));
    if (!packet || packet.type !== 'position') return 0;
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (this.send(connection.updates, packet)) sent++;
    }
    return sent;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer);
    for (const id of this.connections.keys()) this.removePeer(id);
    await this.peer.close('left example room');
  }

  private attachPeer(remote: RemotePeer): void {
    if (this.closed || this.connections.has(remote.id)) return;
    const connection: Connection = {
      remote, lastSequence: -1,
      info: { id: remote.id, name: '另一位指挥官', state: remote.state, route: 'unknown', rttMs: null, ready: false },
    };
    this.connections.set(remote.id, connection);
    remote.on('data-channel', ({ channel }) => this.wireChannel(connection, channel));
    remote.on('connection-reset', () => {
      if (this.connections.get(remote.id) !== connection || this.closed) return;
      this.clearChannels(connection);
      connection.lastSequence = -1;
      connection.info.route = 'unknown';
      connection.info.rttMs = null;
      this.emitPeer(connection);
      this.createChannels(connection);
    });
    remote.on('state-change', ({ to }) => {
      if (this.connections.get(remote.id) !== connection || this.closed) return;
      connection.info.state = to;
      this.emitPeer(connection);
    });
    remote.on('negotiation-error', ({ err }) => {
      if (!this.closed && err.name === 'IceRestartExhaustedError') {
        this.options.onError('对方连接恢复失败，请点击重新连接。');
      }
    });
    this.emitPeer(connection);
    this.createChannels(connection);
  }

  private createChannels(connection: Connection): void {
    // 数据应用必须先创建通道才能触发协商；不能等待 connected 后再创建。
    // polite 是 SDK 的协商角色，与游戏房主身份无关。每对玩家只由一端创建。
    if (connection.remote.polite || this.closed) return;
    this.wireChannel(connection, connection.remote.pc.createDataChannel(CONTROL, { ordered: true }));
    this.wireChannel(connection, connection.remote.pc.createDataChannel(UPDATES, {
      ordered: false, maxRetransmits: 0,
    }));
  }

  private wireChannel(connection: Connection, channel: RTCDataChannel): void {
    if (this.closed || this.connections.get(connection.remote.id) !== connection
      || ![CONTROL, UPDATES].includes(channel.label)) {
      channel.close();
      return;
    }
    const slot = channel.label === CONTROL ? 'control' : 'updates';
    this.disposeChannel(connection[slot]);
    connection[slot] = channel;
    const current = () => !this.closed && this.connections.get(connection.remote.id) === connection
      && connection[slot] === channel;
    channel.onopen = () => {
      if (!current()) return;
      if (slot === 'control') this.send(channel, { v: 1, type: 'hello', name: this.options.name.trim() });
      this.emitPeer(connection);
      void this.refreshStats();
    };
    channel.onmessage = event => {
      if (!current()) return;
      const packet = decodePacket(event.data);
      if (!packet || (slot === 'updates') !== (packet.type === 'position')) return;
      if (packet.type === 'position') {
        // 无序、不重传的快照通道：拒绝晚到的旧帧。
        if (packet.seq <= connection.lastSequence) return;
        connection.lastSequence = packet.seq;
      }
      if (packet.type === 'hello') {
        connection.info.name = packet.name;
        this.emitPeer(connection);
      }
      this.options.onPacket(connection.remote.id, packet);
    };
    channel.onclose = () => { if (current()) this.emitPeer(connection); };
    channel.onerror = () => { if (current()) this.emitPeer(connection); };
    if (channel.readyState === 'open') channel.onopen(new Event('open'));
  }

  private send(channel: RTCDataChannel | undefined, packet: Packet): boolean {
    if (this.closed || !channel || channel.readyState !== 'open') return false;
    const data = JSON.stringify(packet);
    const size = new TextEncoder().encode(data).byteLength;
    // 不堆积旧快照，也不为可靠消息创建无界应用队列。
    if (size > MAX_PACKET_BYTES || channel.bufferedAmount + size > MAX_BUFFER_BYTES) return false;
    try { channel.send(data); return true; } catch { return false; }
  }

  private emitPeer(connection: Connection): void {
    connection.info.ready = connection.control?.readyState === 'open' && connection.updates?.readyState === 'open';
    this.options.onPeer({ ...connection.info }, connection.remote.id);
  }

  private disposeChannel(channel?: RTCDataChannel): void {
    if (!channel) return;
    channel.onopen = channel.onmessage = channel.onclose = channel.onerror = null;
    channel.close();
  }

  private clearChannels(connection: Connection): void {
    this.disposeChannel(connection.control);
    this.disposeChannel(connection.updates);
    connection.control = connection.updates = undefined;
  }

  private removePeer(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    this.clearChannels(connection);
    this.options.onPeer(null, id);
  }

  private async refreshStats(): Promise<void> {
    if (this.closed || this.statsPending) return;
    this.statsPending = true;
    try {
      for (const connection of this.connections.values()) {
        const pc = connection.remote.pc as RTCPeerConnection;
        if (typeof pc.getStats !== 'function' || pc.connectionState !== 'connected') continue;
        try {
          const report = await pc.getStats();
          if (this.closed || this.connections.get(connection.remote.id) !== connection || connection.remote.pc !== pc) continue;
          let pair: RTCStats | undefined;
          report.forEach(stat => {
            if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId);
          });
          if (!pair) report.forEach(stat => {
            if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') pair = stat;
          });
          if (!pair) continue;
          const selected = pair as RTCStats & { localCandidateId: string; remoteCandidateId: string; currentRoundTripTime?: number };
          const local = report.get(selected.localCandidateId);
          const remote = report.get(selected.remoteCandidateId);
          connection.info.route = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
            ? 'relay' : local && remote ? 'direct' : 'unknown';
          connection.info.rttMs = typeof selected.currentRoundTripTime === 'number'
            ? Math.round(selected.currentRoundTripTime * 1000) : null;
          this.emitPeer(connection);
        } catch { /* 切网或旧连接正在关闭时，下一轮重新读取。 */ }
      }
    } finally { this.statsPending = false; }
  }

  private explainError(error: Error): string {
    const messages: Record<string, string> = {
      invalid_token: 'Publishable key 无效或已撤销。',
      channel_not_authorized: '此密钥没有房间权限，请检查 Subscribe、Presence 与 Send 权限。',
      account_suspended: 'Metered 账户不可用，请检查账户状态与额度。',
      admin_disconnect: '连接已由服务端关闭，请重新加入。',
    };
    return messages[error.name] ?? `连接异常：${error.message}`;
  }
}
