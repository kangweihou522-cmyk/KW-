const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { ChatGptPlan } = require('./chatGptPlan.cjs');
const { parseLocalPdf } = require('./localPdfParser.cjs');
const { analyzeEvidence } = require('./reportAnalysis.cjs');
const { isReadingReport, ReadingHistory } = require('./readingHistory.cjs');

const isReport = isReadingReport;
function reportRequest(paper, text, label = 'ChatGPT 套餐', model = '', scope = '') {
  const content = `来源：${label}${model ? `（${model}）` : ''}生成的初稿，尚未人工核对。${scope || '仅分析可提取文字，图像与公式需核对。'}\n\n${text}`;
  return { paperId: paper.id, title: `${paper.title} · 读书报告`, type: 'ai-chat', content, contentText: content,
    contentJson: { type: 'doc', content: content.split(/\r?\n/).map(line => { const heading = /^(#{1,3})\s+(.*)$/.exec(line); const text = heading ? heading[2] : line; return { type: heading ? 'heading' : 'paragraph', ...(heading ? { attrs: { level: heading[1].length } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) }; }) },
    linkedPaperId: paper.id, linkedPaperIds: [paper.id], tags: ['读书报告', '文献报告', ...(label.startsWith('ChatGPT') ? ['ChatGPT报告'] : [])] };
}
async function evidenceForPaper(paper) {
  const attachments = paper.attachments.filter(item => item.kind === 'pdf' || item.kind === 'supplement');
  const parts = []; const warnings = []; let length = 0;
  for (const attachment of attachments) {
    const file = attachment.storedPath; const name = attachment.fileName || path.basename(file || '');
    if (!file || !path.isAbsolute(file)) { warnings.push(`${name}：路径不可用，未分析。`); continue; }
    const ext = path.extname(file).toLowerCase(); let text;
    if (!['.pdf', '.txt', '.md', '.csv'].includes(ext)) { warnings.push(`${name}：当前仅保管，未分析。`); continue; }
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) { warnings.push(`${name}：文件缺失，未分析。`); continue; }
    if (stat.size > 64 * 1024 * 1024) throw new Error(`${name} 超过本次阅读限制，请先拆分文件。`);
    try {
      if (ext === '.pdf') { const parsed = await parseLocalPdf(file); text = parsed.markdown; warnings.push(...parsed.warnings.map(w => `${name}：${w}`)); }
      else text = await fs.readFile(file, 'utf8');
    } catch (error) { warnings.push(`${name}：${error.message}`); if (attachment.kind === 'pdf') throw error; else continue; }
    length += text.length;
    if (length > 240000) throw new Error('论文及补充材料超过本次文本容量，已停止提交；请拆分材料，未静默截断或声称阅读全文。');
    parts.push(`【文件：${name}；仅提取文字，PDF 页码为物理页码】\n${text}`);
  }
  if (!parts.length) throw new Error('没有可分析的本地文献文字。请关联可搜索 PDF，扫描件请先 OCR。');
  return { text: parts.join('\n\n'), warnings };
}
function createChatGptCommands(context) {
  const { store, noteStore, appPaths } = context;
  const bridge = context.chatGptBridge || new ChatGptPlan(context);
  const provider = context.reportProvider || bridge;
  const history = context.readingHistory || new ReadingHistory(context);
  const reports = new Map(); const controllers = new Map();
  context.app?.once?.('before-quit', () => bridge.close());
  function existingReport(paperId) { return noteStore.listNotes({ paperId, limit: 5000 }).find(isReport) || null; }
  return {
    chatgpt_status() { return bridge.account(); },
    chatgpt_connect() { return bridge.login(context.shell || require('electron').shell); },
    chatgpt_disconnect() { return bridge.logout(); },
    chatgpt_models() { return bridge.models(); },
    chatgpt_set_model({ model }) { return bridge.selectModel(model); },
    async chatgpt_test_connection() { return { text: await bridge.complete('请只回复“连接成功”。本请求只测试连接。'), ...await bridge.account() }; },
    report_cancel({ paperId }) { controllers.get(paperId)?.abort(); return { canceled: true }; },
    async chatgpt_generate_report({ paperId, force = false } = {}, event) {
      const existing = existingReport(paperId);
      if (existing && !force) return { note: existing, cached: true, warnings: [] };
      if (reports.has(paperId)) return reports.get(paperId);
      const task = (async () => {
        const paper = store.load().papers.find(item => item.id === paperId);
        if (!paper) throw new Error('未找到此文献。');
        const previousOverview = paper.aiSummary || '';
        const controller = new AbortController(); controllers.set(paperId, controller);
        const evidence = await evidenceForPaper(paper);
        let analysis;
        try { analysis = await analyzeEvidence({ evidence, provider, appPaths, paperId, signal: controller.signal,
          onProgress: progress => { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('paperquay:event', 'paperdesk:report-progress', { paperId, ...progress }); } }); }
        catch (error) {
          if (error.partialText) { const directory = path.join(appPaths.dataDir, '.chatgpt-reports'); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, `${createHash('sha256').update(`${paperId}:${Date.now()}`).digest('hex')}.json`), JSON.stringify({ paperId, text: error.partialText, incomplete: true }), 'utf8'); }
          throw error;
        }
        if (controller.signal.aborted) throw new Error('报告生成已取消，未修改现有笔记。');
        const { text, info, scope } = analysis;
        // Keep a recovery copy before attempting any note/library mutation.
        const resultDir = path.join(appPaths.dataDir, '.chatgpt-reports'); await fs.mkdir(resultDir, { recursive: true });
        const recoveryId = createHash('sha256').update(`${paperId}:${Date.now()}:${text}`).digest('hex');
        await fs.writeFile(path.join(resultDir, `${recoveryId}.json`), JSON.stringify({ paperId, text, warnings: evidence.warnings }), 'utf8');
        const latest = existingReport(paperId);
        if ((latest?.id || null) !== (existing?.id || null) || latest && (latest.updatedAt !== existing.updatedAt || latest.content !== existing.content)) {
          throw new Error('报告生成期间本地笔记已被修改，未覆盖。生成结果已保留在 data/.chatgpt-reports，可恢复。');
        }
        history.capture(paperId, '生成新报告前');
        const request = reportRequest(paper, text, info.label, info.model === 'legacy-test' ? '' : info.model, scope);
        const note = latest ? noteStore.updateNote({ id: latest.id, patch: { ...request, tags: [...new Set([...latest.tags, ...request.tags])] } }) : noteStore.createNote(request);
        let overviewSynced = true;
        try { const library = store.load(); const current = library.papers.find(item => item.id === paperId); if (current && (current.aiSummary || '') === previousOverview) { current.aiSummary = text; await store.save(library); } else overviewSynced = false; }
        catch { overviewSynced = false; }
        return { note, cached: false, warnings: evidence.warnings, overviewSynced, overviewText: text, provider: info.provider };
      })().finally(() => {
        reports.delete(paperId); controllers.delete(paperId);
        if (event?.sender && !event.sender.isDestroyed()) event.sender.send('paperquay:event', 'paperdesk:report-progress', { paperId, stage: 'ended' });
      });
      reports.set(paperId, task); return task;
    },
    async chatgpt_ask_paper({ paperId, question } = {}) {
      if (typeof question !== 'string' || !question.trim() || question.length > 12000) throw new Error('请填写不超过 12000 字的文献问题。');
      const paper = store.load().papers.find(item => item.id === paperId); if (!paper) throw new Error('未找到此文献。');
      const evidence = await evidenceForPaper(paper);
      const cacheId = createHash('sha256').update(JSON.stringify([paperId, question.trim(), evidence.text])).digest('hex');
      const cacheFile = path.join(appPaths.dataDir, '.chatgpt-questions', `${cacheId}.json`);
      try { const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8')); if (saved.text) return { ...saved, cached: true }; } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      const info = provider.info ? await provider.info() : { context: 32000 };
      if (Buffer.byteLength(evidence.text) > Math.max(1200, Math.min(48000, info.context - 7000))) throw new Error('当前材料超过本次问答容量。请先生成分段报告，再围绕本地报告继续核对原文。');
      const text = await provider.complete(`请只根据以下材料回答用户问题，说明证据页码与材料范围，不确定内容明确标注。\n问题：${question}\n限制：${evidence.warnings.join('；')}\n<untrusted_paper_text>\n${evidence.text}\n</untrusted_paper_text>`);
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify({ text, warnings: evidence.warnings }), 'utf8');
      return { text, warnings: evidence.warnings, cached: false };
    },
  };
}
module.exports = { createChatGptCommands, evidenceForPaper, isReport, reportRequest };
