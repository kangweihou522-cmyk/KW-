import { useSyncExternalStore } from 'react';

// One live draft per paper, shared by sidebar and dialog. Never clear after saving.
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
function key(paperId: string) { return `paperdesk:chatgpt-draft:${paperId}`; }
export function readChatGptDraft(paperId: string): string {
  if (!drafts.has(paperId)) drafts.set(paperId, localStorage.getItem(key(paperId)) ?? '');
  return drafts.get(paperId)!;
}
export function writeChatGptDraft(paperId: string, value: string) {
  // Persist first so a storage error cannot silently discard the previous draft.
  localStorage.setItem(key(paperId), value);
  drafts.set(paperId, value);
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const storage = () => { drafts.clear(); listener(); };
  window.addEventListener('storage', storage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
}
export function useChatGptDraft(paperId: string) {
  return useSyncExternalStore(subscribe, () => readChatGptDraft(paperId));
}
