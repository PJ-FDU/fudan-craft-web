export const GROUP_KEYS = ['1','2','3','4','5','6','7','8','9','0'] as const;
export type GroupKey = typeof GROUP_KEYS[number];
export type GroupAction = 'save' | 'append' | 'recall' | 'add';

export function groupKey(key: string): GroupKey | undefined {
  return GROUP_KEYS.find(candidate => candidate === key);
}

export function groupAction(modifier: boolean, shift: boolean): GroupAction {
  return modifier ? (shift ? 'append' : 'save') : (shift ? 'add' : 'recall');
}

export function groupShortcut(event: Pick<KeyboardEvent,'code'|'key'|'altKey'|'ctrlKey'|'metaKey'|'shiftKey'>) {
  if (event.altKey) return;
  // Shift changes the reported character on many keyboard layouts.
  const key = groupKey(event.code.startsWith('Digit') ? event.code.slice(5) : event.key);
  if (key) return { key, action: groupAction(event.ctrlKey || event.metaKey, event.shiftKey) };
}

export function readGroups(value: unknown): Map<GroupKey,number[]> {
  const result = new Map<GroupKey,number[]>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of GROUP_KEYS) {
    const ids = (value as Record<string,unknown>)[key];
    if (Array.isArray(ids)) {
      const members = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0,500);
      if (members.length) result.set(key,members);
    }
  }
  return result;
}
