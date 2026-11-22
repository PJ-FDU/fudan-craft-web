/** 控件使用真实矢量路径，避免移动端把 Unicode 符号替换成彩色 emoji。 */
const paths = {
  'arrow-up-right': 'M5 19 19 5M7 5h12v12',
  attack: 'M12 2v4m0 12v4M2 12h4m12 0h4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  repair: 'm4 20 9-9m-5-7 4-2 8 8-4 4-8-10ZM3 17l4 4',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z',
  stop: 'M5 5h14v14H5Z',
  army: 'M15 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6 21v-4a6 6 0 0 1 12 0v4M3 5a3 3 0 0 1 0 6m18-6a3 3 0 0 1 0 6M2 14v5m20-5v5',
  dispatch: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm14 0v7m-3-3.5h7',
  check: 'm5 12 4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  logistics: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  gear: 'm9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  star: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Zm7 5v2',
  pause: 'M8 5v14m8-14v14',
  play: 'm7 4 13 8-13 8Z',
  close: 'm6 6 12 12M18 6 6 18',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  home: 'm3 10 9-7 9 7M5 9v12h14V9m-9 12v-7h4v7',
} as const;

export type UIIcon = keyof typeof paths;

export function uiIcon(name: UIIcon) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[name]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** 静态首页和战场壳只初始化一次；动态菜单直接调用 uiIcon。 */
export function mountUIIcons(root: HTMLElement) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-ui-icon]')) {
    const name = node.dataset.uiIcon;
    if (name && Object.hasOwn(paths, name)) node.innerHTML = uiIcon(name as UIIcon);
  }
}
