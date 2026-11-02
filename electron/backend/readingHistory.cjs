const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function isReadingReport(note) {
  return !!note?.tags?.includes('读书报告') && note.tags.some(tag => ['文献报告', 'ChatGPT报告', 'ChatGPT手动回填'].includes(tag));
}
function comparable(text) { return String(text || '').replace(/^来源：[^\n]*\n\n/, '').trim(); }
function reportPatch(note) {
  const keys = ['paperId', 'title', 'type', 'content', 'contentText', 'contentJson', 'tags', 'linkedPaperId', 'linkedPaperIds', 'color'];
  return Object.fromEntries(keys.filter(key => note[key] !== undefined).map(key => [key, note[key]]));
}
class ReadingHistory {
  constructor(context) { this.context = context; this.running = new Map(); }
  directory(paperId) { return path.join(this.context.appPaths.dataDir, '.reading-history', createHash('sha256').update(paperId).digest('hex')); }
  report(paperId) { return this.context.noteStore.listNotes({ paperId, limit: 5000 }).find(isReadingReport) || null; }
  paper(paperId) {
    if (typeof paperId !== 'string' || !paperId || paperId.length > 300) throw new Error('无效文献标识。');
    const paper = this.context.store.load().papers.find(item => item.id === paperId);
    if (!paper) throw new Error('未找到此文献，未修改其他记录。');
    return paper;
  }
  capture(paperId, reason) {
    if (typeof paperId !== 'string' || !paperId || paperId.length > 300) return;
    const paper = this.context.store?.load().papers.find(item => item.id === paperId) || {};
    const report = this.report(paperId);
    if (!paper.aiSummary && !report) return;
    const record = { id: randomUUID(), paperId, createdAt: new Date().toISOString(), reason, overview: paper.aiSummary || '', report };
    const directory = this.directory(paperId); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${record.id}.json`); const temporary = `${file}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    return record;
  }
  list(paperId) {
    if (typeof paperId !== 'string' || !paperId || paperId.length > 300) throw new Error('无效文献标识。');
    const directory = this.directory(paperId);
    const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(file => /^[0-9a-f-]{36}\.json$/.test(file)) : [];
    return files.map(file => { try { return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')); } catch { return null; } })
      .filter(record => record?.paperId === paperId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100).map(({ id, createdAt, reason, overview, report }) => ({ id, createdAt, reason, overview, reportText: report?.contentText || report?.content || '' }));
  }
  async exclusive(paperId, action) {
    const previous = this.running.get(paperId) || Promise.resolve();
    const job = previous.catch(() => {}).then(action); this.running.set(paperId, job);
    try { return await job; } finally { if (this.running.get(paperId) === job) this.running.delete(paperId); }
  }
  async saveOverview({ paperId, content, expectedOverview }) {
    if (typeof content !== 'string' || content.length > 500000 || typeof expectedOverview !== 'string') throw new Error('概览内容或保存版本无效。');
    return this.exclusive(paperId, async () => {
      const paper = this.paper(paperId);
      if ((paper.aiSummary || '') !== expectedOverview) throw new Error('概览已在其他窗口更新，未覆盖。当前草稿已保留，请先查看最新本地版本。');
      this.capture(paperId, '编辑概览前');
      const library = this.context.store.load(); const target = library.papers.find(item => item.id === paperId);
      target.aiSummary = content; await this.context.store.save(library);
      return this.paper(paperId);
    });
  }
  async syncEditedNote(before, after) {
    if (!isReadingReport(before) || !after.paperId || !this.context.store) return null;
    return this.exclusive(after.paperId, async () => {
      const paper = this.paper(after.paperId);
      // An independently edited overview must not be replaced by a report edit.
      if (comparable(paper.aiSummary) !== comparable(before.contentText || before.content)) return null;
      const library = this.context.store.load(); const target = library.papers.find(item => item.id === after.paperId);
      target.aiSummary = after.contentText || after.content || ''; await this.context.store.save(library);
      return { paperId: after.paperId, aiSummary: target.aiSummary };
    });
  }
  async restore({ paperId, id, target = 'overview', expectedOverview, expectedReportUpdatedAt = null, expectedReportContent = null }) {
    if (!/^[0-9a-f-]{36}$/.test(id) || !['overview', 'report'].includes(target)) throw new Error('历史版本标识无效。');
    const record = JSON.parse(fs.readFileSync(path.join(this.directory(paperId), `${id}.json`), 'utf8'));
    if (record.paperId !== paperId) throw new Error('历史版本不属于当前文献。');
    if (target === 'overview') return { paper: await this.saveOverview({ paperId, content: record.overview, expectedOverview }) };
    return this.exclusive(paperId, async () => {
      this.paper(paperId); const existing = this.report(paperId);
      if (!record.report) throw new Error('该版本没有完整报告。');
      if ((existing?.updatedAt || null) !== expectedReportUpdatedAt || (existing?.content || null) !== expectedReportContent) throw new Error('报告已被更新，未覆盖，请重新加载。');
      this.capture(paperId, '恢复报告前');
      const patch = reportPatch(record.report);
      const note = existing ? this.context.noteStore.updateNote({ id: existing.id, patch }) : this.context.noteStore.createNote(patch);
      return { note };
    });
  }
}
function createReadingHistoryCommands(context) {
  return {
    reading_history_list({ paperId }) { return context.readingHistory.list(paperId); },
    reading_overview_save(args) { return context.readingHistory.saveOverview(args); },
    reading_history_restore(args) { return context.readingHistory.restore(args); },
  };
}
module.exports = { ReadingHistory, createReadingHistoryCommands, isReadingReport, comparable };
