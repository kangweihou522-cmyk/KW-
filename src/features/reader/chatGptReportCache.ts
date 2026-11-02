import { invoke } from '../../platform/electron/core';
import { useSyncExternalStore } from 'react';

// One live draft per paper, shared by sidebar and dialog. Never clear after saving.
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const loaded = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const sourceId = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'report-editor';
function loadDatabaseDraft(paperId: string) {
  if (loaded.has(paperId) || typeof window === 'undefined' || !window.paperquay?.invoke) return;
  loaded.add(paperId);
  void invoke<{drafts: {content: string; updatedAt: number}[]}>('paper_document_get', {paperId, kind: 'report'}).then(value => {
    const latest = value.drafts?.[0];
    if (typeof latest?.content === 'string' && !localStorage.getItem(key(paperId))) {
      localStorage.setItem(key(paperId), latest.content); drafts.set(paperId, latest.content); listeners.forEach(listener => listener());
    }
  }).catch(() => { loaded.delete(paperId); });
}
function key(paperId: string) { return `paperdesk:chatgpt-draft:${paperId}`; }
export function readChatGptDraft(paperId: string): string {
  loadDatabaseDraft(paperId);
  if (!drafts.has(paperId)) drafts.set(paperId, localStorage.getItem(key(paperId)) ?? '');
  return drafts.get(paperId)!;
}
export function writeChatGptDraft(paperId: string, value: string) {
  // Persist first so a storage error cannot silently discard the previous draft.
  localStorage.setItem(key(paperId), value);
  drafts.set(paperId, value);
  if (typeof window !== 'undefined' && window.paperquay?.invoke) {
    clearTimeout(timers.get(paperId));
    timers.set(paperId, setTimeout(() => {
      timers.delete(paperId);
      void invoke('paper_document_draft', { paperId, kind: 'report', sourceId, baseVersion: 0, content: value }).catch(() => window.dispatchEvent(new CustomEvent('paperdesk:report-draft-error', {detail: {paperId}})));
    }, 300));
  }
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
