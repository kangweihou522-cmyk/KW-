const { isReadingReport } = require('./readingHistory.cjs');
function createNoteCommands(context) {
  const { noteStore } = context;

  return {
    notes_save_chatgpt_report({ request, expectedUpdatedAt = null, expectedContent = null }) {
      if (!request?.paperId || !request.contentText?.trim()) throw new Error('请选择文献并填写报告。');
      const existing = noteStore.listNotes({ paperId: request.paperId }).find(isReadingReport);
      if (existing && (existing.updatedAt !== expectedUpdatedAt || existing.content !== expectedContent)) {
        throw new Error('报告已在其他窗口或笔记编辑器中修改，请先重新加载本地报告，避免覆盖。草稿仍保留。');
      }
      context.readingHistory?.capture(request.paperId, '保存报告前');
      const note = existing
        ? noteStore.updateNote({ id: existing.id, patch: { ...request, tags: [...new Set([...existing.tags, ...request.tags])] } })
        : noteStore.createNote(request);
      if (existing && context.readingHistory) return context.readingHistory.syncEditedNote(existing, note)
        .then(readingOverview => readingOverview ? { ...note, readingOverview } : note).catch(() => note);
      return note;
    },

    notes_list({ request = {} }) {
      return noteStore.listNotes(request);
    },

    notes_get({ id }) {
      return noteStore.getNote({ id });
    },

    notes_create({ request }) {
      return noteStore.createNote(request ?? {});
    },

    async notes_update({ id, patch }) {
      const before = noteStore.getNote({ id });
      if (isReadingReport(before)) context.readingHistory?.capture(before.paperId, '编辑报告前');
      const note = noteStore.updateNote({ id, patch: patch ?? {} });
      let readingOverview = null;
      try { readingOverview = await context.readingHistory?.syncEditedNote(before, note); } catch { /* The saved note remains authoritative; the separate overview is retained. */ }
      return readingOverview ? { ...note, readingOverview } : note;
    },

    notes_delete({ id }) {
      noteStore.deleteNote({ id });
    },

    notes_tags({ request = {} }) {
      return noteStore.listTags(request);
    },

    notes_backlinks({ noteId }) {
      return noteStore.listBacklinks({ noteId });
    },
  };
}

module.exports = { createNoteCommands };
