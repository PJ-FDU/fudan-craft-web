import './style.css';
import { MeteredRoom, type PeerInfo } from './metered-room';
import { createRoom, normalizeRoom, validateKey } from './protocol';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const name = element<HTMLInputElement>('name');
const key = element<HTMLInputElement>('key');
const room = element<HTMLInputElement>('room');
const relay = element<HTMLInputElement>('relay');
const status = element('status');
const error = element('error');
const board = element<HTMLButtonElement>('board');
const create = element<HTMLButtonElement>('create');
const join = element<HTMLButtonElement>('join');
const leave = element<HTMLButtonElement>('leave');
const retry = element<HTMLButtonElement>('retry');
const invite = element<HTMLButtonElement>('invite');
const send = element<HTMLButtonElement>('send');
const message = element<HTMLInputElement>('message');
const peers = new Map<string, PeerInfo>();
const dots = new Map<string, HTMLElement>();
let active: MeteredRoom | null = null;
let activeRoom = '';
let position = { x: .5, y: .5 };
let sent = 0;
let received = 0;
let lastError = '';
let connectionAttempt = 0;

key.value = import.meta.env.VITE_METERED_PUBLISHABLE_KEY?.trim() ?? '';
element<HTMLDetailsElement>('configuration').open = !key.value;
room.value = new URLSearchParams(location.hash.slice(1)).get('room') ?? '';

function showError(value: string): void {
  error.textContent = value;
  error.hidden = !value;
  if (value && value !== lastError) appendMessage('系统', value);
  lastError = value;
}

function controls(): void {
  for (const input of [name, key, relay, room]) input.disabled = !!active;
  create.disabled = join.disabled = !!active;
  leave.disabled = retry.disabled = invite.disabled = !active;
  send.disabled = !Array.from(peers.values()).some(peer => peer.ready);
}

function appendMessage(author: string, text: string): void {
  const list = element<HTMLOListElement>('messages');
  const item = document.createElement('li');
  const label = document.createElement('strong');
  label.textContent = author;
  item.append(label, document.createTextNode(text));
  list.append(item);
  while (list.children.length > 12) list.firstElementChild?.remove();
}

function counts(): void {
  element('counts').textContent = `发送 ${sent} · 接收 ${received}`;
}

function renderPeers(): void {
  const list = element('peers');
  list.replaceChildren();
  if (!peers.size) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = active ? '房间已准备，等待另一端加入。' : '另一端尚未加入。';
    list.append(note);
  }
  for (const peer of peers.values()) {
    const row = document.createElement('div');
    row.className = 'peer';
    const title = document.createElement('strong');
    title.textContent = peer.name;
    const detail = document.createElement('span');
    const route = { unknown: '检测路径中', direct: '直连', relay: 'TURN 中继' }[peer.route];
    detail.textContent = `${peer.ready ? '通道已就绪' : peer.state === 'reconnecting' ? '正在重连' : '连接中'} · ${route}${peer.rttMs === null ? '' : ` · RTT ${peer.rttMs} ms`}`;
    row.append(title, detail);
    list.append(row);
  }
  controls();
}

function placeDot(dot: HTMLElement, x: number, y: number): void {
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;
}

async function disconnect(): Promise<void> {
  const previous = active;
  active = null;
  peers.clear();
  for (const dot of dots.values()) dot.remove();
  dots.clear();
  renderPeers();
  controls();
  if (previous) await previous.close();
}

async function connect(code: string): Promise<void> {
  const attempt = ++connectionAttempt;
  try {
    const publishableKey = validateKey(key.value);
    const normalized = normalizeRoom(code);
    const nickname = name.value.trim();
    if (!nickname) throw new Error('请填写指挥官名称。');
    await disconnect();
    if (attempt !== connectionAttempt) return;
    showError('');
    const candidate = new MeteredRoom({
      key: publishableKey, name: nickname, relayOnly: relay.checked,
      onState: state => {
        if (active !== candidate) return;
        const text: Record<string, string> = {
          idle: '准备连接', joining: '正在连接房间…', joined: '已加入房间，等待数据通道就绪。',
          reconnecting: '网络中断，正在恢复连接；等待较久时可以点击重新连接。',
          leaving: '正在离开房间…', closed: '连接已关闭，请重新连接或离开房间。',
        };
        status.textContent = text[state] ?? state;
      },
      onPeer: (info, id) => {
        if (active !== candidate) return;
        if (info) peers.set(id, info);
        else { peers.delete(id); dots.get(id)?.remove(); dots.delete(id); }
        renderPeers();
        if (Array.from(peers.values()).some(peer => peer.ready)) {
          status.textContent = '另一端已连接。点击空地或发送消息，验证同步。';
        }
      },
      onPacket: (id, packet) => {
        if (active !== candidate) return;
        received++;
        counts();
        if (packet.type === 'chat') appendMessage(peers.get(id)?.name ?? '另一端', packet.text);
        if (packet.type === 'position') {
          let dot = dots.get(id);
          if (!dot) {
            dot = document.createElement('span');
            dot.className = 'dot remote';
            const label = document.createElement('span');
            label.textContent = peers.get(id)?.name ?? '另一端';
            dot.append(label);
            board.append(dot);
            dots.set(id, dot);
          }
          placeDot(dot, packet.x, packet.y);
        }
        if (packet.type === 'hello') {
          const label = dots.get(id)?.firstElementChild;
          if (label) label.textContent = packet.name;
        }
      },
      onError: value => { if (active === candidate) showError(value); },
    });
    active = candidate;
    activeRoom = normalized;
    room.value = normalized;
    history.replaceState(null, '', `#room=${normalized}`);
    controls();
    await candidate.join(normalized);
    if (active !== candidate) return;
    appendMessage('系统', `已加入房间 ${normalized}。`);
    renderPeers();
  } catch (err) {
    // 用户已离开或开始了新连接时，旧 join 的拒绝不能清掉新会话。
    if (attempt !== connectionAttempt) return;
    await disconnect();
    status.textContent = '连接未完成。请检查配置后重试。';
    showError(err instanceof Error ? err.message : '连接失败。');
  }
}

create.addEventListener('click', () => { void connect(createRoom()); });
join.addEventListener('click', () => { void connect(room.value); });
leave.addEventListener('click', async () => {
  connectionAttempt++;
  await disconnect();
  status.textContent = '已离开房间。';
  showError('');
});
retry.addEventListener('click', () => { void connect(activeRoom); });
invite.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status.textContent = '邀请链接已复制。朋友打开后，点击加入房间。';
  } catch { showError('复制不可用，请直接复制地址栏里的邀请链接。'); }
});
element<HTMLFormElement>('chat').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (!active) throw new Error('请先加入房间。');
    const delivered = active.sendChat(message.value);
    sent += delivered;
    counts();
    appendMessage('你', message.value.trim());
    message.value = '';
    showError('');
  } catch (err) { showError(err instanceof Error ? err.message : '发送失败。'); }
});
board.addEventListener('click', event => {
  if (event.detail === 0) return;
  const rect = board.getBoundingClientRect();
  position = {
    x: Math.min(.94, Math.max(.06, (event.clientX - rect.left) / rect.width)),
    y: Math.min(.90, Math.max(.10, (event.clientY - rect.top) / rect.height)),
  };
  placeDot(element('local-dot'), position.x, position.y);
});
board.addEventListener('keydown', event => {
  const deltas: Record<string, [number, number]> = { ArrowLeft: [-.03, 0], ArrowRight: [.03, 0], ArrowUp: [0, -.03], ArrowDown: [0, .03] };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();
  position = { x: Math.min(.94, Math.max(.06, position.x + delta[0])), y: Math.min(.9, Math.max(.1, position.y + delta[1])) };
  placeDot(element('local-dot'), position.x, position.y);
});
setInterval(() => {
  if (!active || document.hidden || !element<HTMLInputElement>('broadcast').checked) return;
  sent += active.sendPosition(position.x, position.y);
  counts();
}, 100);
window.addEventListener('pagehide', () => {
  connectionAttempt++;
  void disconnect();
});
controls();
