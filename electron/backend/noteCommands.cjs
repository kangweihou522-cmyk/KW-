function createNoteCommands(context) {
  const { noteStore } = context;

  return {
    paper_document_get({ paperId, kind }) { return noteStore.getDocument(paperId, kind); },
    paper_document_save(args) { return noteStore.saveDocument(args); },
    paper_document_draft(args) { return noteStore.saveDocumentDraft(args); },
    paper_document_history({ paperId, kind }) { return noteStore.documentHistory(paperId, kind); },
    notes_versions({ id }) { return noteStore.listNoteVersions(id); },
    notes_restore_version({ id, versionId, expectedUpdatedAt, expectedContent }) {
      const current = noteStore.getNote({ id });
      if (!current || current.updatedAt !== expectedUpdatedAt || current.content !== expectedContent) throw new Error('笔记已变更，请重新加载后再恢复。');
      const version = noteStore.listNoteVersions(id).find(v => v.id === versionId);
      if (!version) throw new Error('历史版本不存在。');
      return noteStore.updateNote({ id, patch: { ...version.note, id, createdAt: current.createdAt } });
    },
    notes_save_chatgpt_report({ request, expectedUpdatedAt = null, expectedContent = null }) {
      if (!request?.paperId || !request.contentText?.trim()) throw new Error('请选择文献并填写报告。');
      const existing = noteStore.listNotes({ paperId: request.paperId }).find((note) =>
        (note.tags.includes('ChatGPT手动回填') || note.tags.includes('ChatGPT报告')) && note.tags.includes('读书报告'));
      if (existing && (existing.updatedAt !== expectedUpdatedAt || existing.content !== expectedContent)) {
        throw new Error('报告已在其他窗口或笔记编辑器中修改，请先重新加载本地报告，避免覆盖。草稿仍保留。');
      }
      return existing
        ? noteStore.updateNote({ id: existing.id, patch: { ...request, tags: [...new Set([...existing.tags, ...request.tags])] } })
        : noteStore.createNote(request);
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

    notes_update({ id, patch }) {
      return noteStore.updateNote({ id, patch: patch ?? {} });
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
