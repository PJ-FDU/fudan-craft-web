import { $, handleHomeKeys } from './shell.js';
import { PAGES_BUILD,SEAT_KEY,parseInvite } from './network/config.js';

const earlyMenu = new AbortController();
const status = $('menu-load-status');
let game: Promise<unknown> | undefined;
let pendingButton: HTMLButtonElement | undefined;

function loadGame() {
  if (!game) {
    game = import('./main.js').then(() => {
      earlyMenu.abort();
      status.textContent = '';
      pendingButton?.click();
    }).catch(() => {
      game = undefined;
      status.textContent = '游戏加载失败，请刷新页面重试。';
    }).finally(() => { pendingButton = undefined; });
  }
  return game;
}

$('title-screen').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('#title-menu button, #home-help');
  if (!button || button.disabled) return;
  event.stopPropagation();
  if (pendingButton) return;
  pendingButton = button;
  status.textContent = '正在加载游戏…';
  void loadGame();
}, {signal: earlyMenu.signal});
window.addEventListener('keydown', handleHomeKeys, {signal: earlyMenu.signal});
window.addEventListener('storage', event => {
  if (event.key === 'fudancraft-save-v2' && event.newValue) void loadGame();
}, {signal: earlyMenu.signal});

// Returning players still get validated save and reconnect state after the first paint.
requestAnimationFrame(() => setTimeout(() => {
  try {
    if (localStorage.getItem('fudancraft-save-v2') || sessionStorage.getItem(SEAT_KEY) || PAGES_BUILD&&parseInvite(location.href)) void loadGame();
  } catch { /* Storage can be disabled. */ }
}, 0));
