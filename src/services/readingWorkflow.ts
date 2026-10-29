import { invoke } from '../platform/electron/core';
import { emitNoteChanged } from '../app/appEvents';
import { listNotes } from './notes';
import { updateLibraryPaper } from './library';
import { buildReportNoteRequest } from '../features/reader/readingReport';
import type { Note } from '../types/notes';

export async function getChatGptReport(paperId: string) {
  return (await listNotes({ paperId })).find((note) =>
    (note.tags.includes('ChatGPT手动回填') || note.tags.includes('ChatGPT报告')) && note.tags.includes('读书报告')) ?? null;
}
export async function saveChatGptReport(paperId: string, title: string, text: string, previous: Note | null) {
  const request = buildReportNoteRequest({ paperId, title: `${title} · ChatGPT`, text, source: 'chatgpt-manual' });
  const note = await invoke<Note>('notes_save_chatgpt_report', { request, expectedUpdatedAt: previous?.updatedAt ?? null, expectedContent: previous?.content ?? null });
  emitNoteChanged({ action: previous ? 'updated' : 'created', noteId: note.id, note, updatedAt: note.updatedAt });
  return note;
}
export async function syncChatGptOverview(paperId: string, text: string) {
  // This applies only to a native library ID; imported standalone PDFs still keep their note.
  const paper = await updateLibraryPaper({ paperId, aiSummary: text.trim() });
  window.dispatchEvent(new CustomEvent('paperquay:native-summary-updated', { detail: { paperId, aiSummary: paper.aiSummary } }));
}
