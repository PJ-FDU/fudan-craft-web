import './base.css';
import './title-screen.css';
import './audio.css';
import './locale.css';
import { GameAudio } from './game/game-audio.js';
import { getLanguage, localizeDocument, onLanguageChange, setLanguage, t } from './game/locale.js';
import { lockPageZoom } from './game/viewport-lock.js';
import { mountUIIcons } from './game/icons.js';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const app = $('app');
export const dialog = $<HTMLDialogElement>('dialog');
export const audio = new GameAudio((speaker, text) => {
  const caption = $('audio-caption');
  (dialog.open ? dialog : app).append(caption);
  caption.hidden = !text;
  $('audio-caption-speaker').textContent = speaker;
  $('audio-caption-text').textContent = text;
}, message => toast(message, true));

export function toast(message: string, error = false) {
  const item = document.createElement('div');
  item.className = error ? 'toast error' : 'toast';
  item.textContent = message;
  $('toasts').append(item);
  setTimeout(() => item.remove(), 3500);
  if (error) audio.effect('ui-error', .4, 0, .6);
}

export function syncSound() {
  const enabled = audio.settings.enabled;
  $('sound').textContent = `声音 ${enabled ? '开' : '关'}`;
  $('sound').setAttribute('aria-label', enabled ? '关闭声音' : '开启声音');
  $('home-sound-label').textContent = enabled ? '声音' : '静音';
  $('home-sound').setAttribute('aria-label', enabled ? '关闭声音' : '开启声音');
  $('home-sound').setAttribute('aria-pressed', String(enabled));
}

export function toggleSound() {
  audio.set('enabled', !audio.settings.enabled);
  syncSound();
  if (audio.settings.enabled) void audio.unlock().then(() => audio.effect('ui-confirm', .35));
}

export function syncFullscreen() {
  const native = !!document.fullscreenElement;
  const immersive = app.classList.contains('theater-mode');
  const active = native || immersive;
  const label = native ? '退出全屏' : immersive ? '退出沉浸模式' : '进入全屏';
  for (const id of ['fullscreen', 'home-fullscreen']) {
    $(`${id}-label`).textContent = active ? '退出' : '全屏';
    $(id).setAttribute('aria-label', label);
    $(id).setAttribute('aria-pressed', String(active));
  }
  $('fullscreen').title = `${active ? '退出' : '进入'}全屏 (F)`;
  app.dispatchEvent(new Event('gamefullscreenchange'));
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (app.classList.contains('theater-mode')) app.classList.remove('theater-mode');
    else if (document.fullscreenEnabled && app.requestFullscreen) await app.requestFullscreen({navigationUI: 'hide'});
    else {
      app.classList.add('theater-mode');
      toast('当前预览限制浏览器全屏，已进入沉浸模式；V 可隐藏控制台');
    }
  } catch {
    app.classList.toggle('theater-mode');
    toast('浏览器未允许系统全屏，已切换沉浸模式');
  }
  syncFullscreen();
}

export function handleHomeKeys(event: KeyboardEvent) {
  if (dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key;
  if (key.toLowerCase() === 'f' || key === '?') {
    event.preventDefault();
    $(key === '?' ? 'home-help' : 'home-fullscreen').click();
  } else if (key === 'Escape' && app.classList.contains('theater-mode')) {
    app.classList.remove('theater-mode');
    syncFullscreen();
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [...$('title-menu').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = key === 'ArrowDown' ? 1 : -1;
    buttons[index < 0 ? 0 : (index + step + buttons.length) % buttons.length]?.focus({preventScroll: true});
  } else if (key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
    event.preventDefault();
    $($<HTMLButtonElement>('continue-game').disabled ? 'start' : 'continue-game').click();
  }
}

lockPageZoom();
mountUIIcons(app);
audio.scene('menu');
document.addEventListener('pointerdown', () => void audio.unlock(), {capture: true});
document.addEventListener('keydown', () => void audio.unlock(), {capture: true});
document.addEventListener('visibilitychange', () => audio.visibility(document.hidden));
document.addEventListener('click', event => {
  const button = (event.target as Element).closest('button');
  if (button && !button.disabled) audio.effect('ui-click', .25);
}, {capture: true});
let audioHover: Element | null = null;
document.addEventListener('pointerover', event => {
  const button = (event.target as Element).closest('button');
  if (button === audioHover) return;
  audioHover = button;
  if (button && !button.disabled) audio.effect('ui-hover', .16, 0, .12);
});
document.addEventListener('fullscreenchange', () => {
  app.classList.remove('theater-mode');
  syncFullscreen();
});

function syncLanguage() {
  const language = getLanguage();
  audio.setLanguage(language);
  const button = $('home-language');
  button.querySelector('span')!.textContent = language === 'en' ? '中文' : 'EN';
  button.setAttribute('aria-label', t(language === 'en' ? '切换为中文' : '切换为英文'));
}

localizeDocument();
onLanguageChange(syncLanguage);
syncLanguage();
syncSound();
$('home-language').onclick = () => setLanguage(getLanguage() === 'en' ? 'zh' : 'en');
$('home-sound').onclick = toggleSound;
$('home-fullscreen').onclick = () => void toggleFullscreen();
window.addEventListener('storage', event => {
  if (event.key === 'fudancraft-language-v1') setLanguage(event.newValue === 'en' ? 'en' : 'zh');
});
