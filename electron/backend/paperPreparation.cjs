const fs = require('node:fs/promises');
const path = require('node:path');
const { hash, normalizeText, writeJson, readJson } = require('./translationMemory.cjs');
const { localAiOptions } = require('./localAi.cjs');

function translationUnits(pages) {
  const units = [];
  pages.forEach((blocks, pageIndex) => {
    let text = ''; let previous;
    const flush = () => { if (text.trim()) units.push({ id: `p${pageIndex + 1}-${units.length}`, pageIndex, text: normalizeText(text) }); text = ''; };
    for (const block of blocks) {
      if (typeof block.content !== 'string' || !block.content.trim()) continue;
      const box = block.bbox; const old = previous?.bbox;
      if (text && (text.length + block.content.length > 900 || box && old && (box[1] - old[3] > Math.max(10, (old[3] - old[1]) * 1.1) || box[0] < old[0] - 50))) flush();
      text += (text ? '\n' : '') + block.content; previous = block;
    }
    flush();
  });
  return units;
}
function formatReport(summary, warnings = []) {
  const sections = [['梗概', summary.overview || summary.abstract], ['背景与问题', [summary.background, summary.researchProblem].filter(Boolean).join('\n\n')], ['试验方法设计', [summary.approach, summary.experimentSetup].filter(Boolean).join('\n\n')], ['数据分析处理', summary.dataAnalysis], ['主要结果与证据', summary.keyFindings], ['讨论与整合', summary.discussion], ['主要结论', summary.conclusions], ['证据评价及局限', [summary.evidenceEvaluation, summary.limitations].filter(Boolean).join('\n\n')], ['要点', summary.takeaways]];
  return sections.map(([title, value]) => `## ${title}\n${Array.isArray(value) ? value.join('\n') : value || '原文未报告／材料不足。'}`).join('\n\n') + `\n\n## 材料范围\n仅分析本地提取文字；图像与复杂公式需对照原文。${warnings.join('；')}`;
}
function doiFromText(text) {
  const match = text.match(/(?:doi\s*:\s*|doi\.org\/)(10\.\d{4,9}\/[^\s<>]+)/i) || text.match(/\b(10\.\d{4,9}\/[^\s<>]+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') || '';
}
function createPreparationCommands(context, commands) {
  const runs = new Map(); const prefetches = new Map(); let active;
  const directory = paperId => path.join(context.appPaths.dataDir, '.preparation', hash(paperId));
  const paperFor = paperId => {
    const paper = context.store.load().papers.find(item => item.id === paperId);
    if (!paper) throw new Error('未找到此文献。');
    return paper;
  };
  const pdfFor = paper => {
    const file = paper.attachments.find(item => item.kind === 'pdf')?.storedPath;
    if (!file) throw new Error('请先关联本地 PDF。');
    return file;
  };
  async function sourceFor(paperId) {
    const paper = paperFor(paperId); const pdfPath = pdfFor(paper); const stat = await fs.stat(pdfPath);
    const signature = hash([pdfPath, stat.size, stat.mtimeMs, stat.ctimeMs]);
    const file = path.join(directory(paperId), 'source.json'); const saved = await readJson(file);
    if (saved?.version === 1 && saved.signature === signature) return saved;
    const result = await commands.run_mineru_cloud_parse({ options: { pdfPath } });
    const source = { version: 1, signature, pdfPath, pages: JSON.parse(result.contentJsonText), markdown: result.markdownText, jsonPath: result.contentJsonPath, warnings: result.warnings || [] };
    await writeJson(file, source); return source;
  }
  async function notify(run) {
    const state = { ...run.state, updatedAt: Date.now() };
    await writeJson(path.join(directory(state.paperId), 'state.json'), state);
    for (const sender of run.senders) if (!sender.isDestroyed()) sender.send('paperquay:event', 'paperdesk:preparation-progress', state);
  }
  async function checkpoint(run) {
    run.controller.signal.throwIfAborted();
    while (run.state.paused) { await new Promise(resolve => setTimeout(resolve, 100)); run.controller.signal.throwIfAborted(); }
  }
  async function execute(run, options) {
    const { paperId } = run.state;
    const stage = async (key, work) => {
      await checkpoint(run); run.state.stage = key; run.state.steps[key] = { status: 'running' }; await notify(run);
      try { const message = await work(); run.state.steps[key] = { status: 'done', message: message || '' }; }
      catch (error) {
        if (run.controller.signal.aborted) throw error;
        run.state.steps[key] = { status: 'error', message: error.message || String(error) };
      }
      await notify(run);
    };
    try {
      let source;
      await stage('parse', async () => {
        source = await sourceFor(paperId); run.state.warnings = source.warnings;
        for (const sender of run.senders) if (!sender.isDestroyed()) sender.send('paperquay:event', 'paperdesk:preparation-source', { paperId, pages: source.pages, jsonPath: source.jsonPath });
        return `${source.pages.length} 页`;
      });
      if (!source) throw new Error('PDF 解析未完成，请处理提示后继续。');
      if (options.mode !== 'translation') {
        await stage('metadata', async () => {
          const before = paperFor(paperId); const text = source.pages[0].map(block => block.content || '').join('\n');
          const request = { doi: doiFromText(text) || before.doi, title: before.title, evidenceTitle: before.title, firstPageText: text };
          const metadata = await commands.lookup_literature_metadata({ request });
          run.controller.signal.throwIfAborted();
          if (!metadata?.verified) throw new Error('未找到可靠出版记录，可在编辑文献信息中使用本地分析或手工填写。');
          const latest = paperFor(paperId); const update = { paperId };
          for (const key of ['title', 'publication', 'year', 'volume', 'issue', 'pages', 'publishedDate', 'doi']) {
            if (metadata[key] && latest[key] === before[key]) update[key] = metadata[key];
          }
          if (metadata.authors?.length && JSON.stringify(latest.authors) === JSON.stringify(before.authors)) update.authors = metadata.authors;
          await commands.library_update_paper({ request: update }); return '已核对出版记录';
        });
        await stage('overview', async () => {
          const before = paperFor(paperId);
          if (before.aiSummary?.trim()) return '已保留现有概览及手工修改';
          if (context.noteStore.listNotes({ paperId }).some(note => note.tags.includes('读书报告'))) return '已保留现有本地报告';
          const summary = await commands.summarize_document_openai_compatible({ options: { ...localAiOptions(options.modelOptions), paperId, title: before.title, authors: before.authors.map(author => author.name).join('; '), outputLanguage: 'Chinese', documentText: source.markdown } });
          const text = formatReport(summary, source.warnings);
          // Save a recovery before checking for edits made during inference.
          await writeJson(path.join(context.appPaths.dataDir, '.chatgpt-reports', `${hash([paperId, Date.now(), text])}.json`), { paperId, text, warnings: source.warnings });
          run.controller.signal.throwIfAborted();
          await context.translationMemory.scope({ documentId: `native-library:${paperId}`, pdfPath: source.pdfPath, expectedSignature: source.signature });
          if (paperFor(paperId).aiSummary !== before.aiSummary) throw new Error('生成期间概览已被编辑，未覆盖；生成内容已另存恢复副本。');
          const { reportRequest } = require('./chatGptCommands.cjs');
          const request = reportRequest(before, text);
          request.title = `${before.title} · 本地读书报告`; request.tags = ['读书报告', '本地编辑报告'];
          const intro = '来源：本地模型生成，尚未人工核对。仅分析已提取文字，图像和公式请对照原文。';
          request.content = request.contentText = `${intro}\n\n${text}`;
          request.contentJson.content[0].content[0].text = intro;
          const existing = context.noteStore.listNotes({ paperId }).find(note => note.tags.includes('读书报告') && ['ChatGPT手动回填', 'ChatGPT报告', '本地编辑报告'].some(tag => note.tags.includes(tag)));
          if (existing) throw new Error('已有本地报告，已保留；新生成内容已另存恢复副本。');
          const note = await commands.notes_save_chatgpt_report({ request });
          for (const sender of run.senders) if (!sender.isDestroyed()) sender.send('paperquay:event', 'paperdesk:preparation-note', note);
          if (paperFor(paperId).aiSummary !== before.aiSummary) throw new Error('概览已被编辑，未覆盖；报告已单独保存。');
          await commands.library_update_paper({ request: { paperId, aiSummary: text } }); return '已生成并保存，可继续编辑';
        });
      }
      await stage('translation', async () => {
        const units = translationUnits(source.pages); const results = [];
        run.state.total = units.length; run.state.completed = 0; run.state.cached = 0;
        for (const unit of units) {
          await checkpoint(run);
          const result = await context.translationMemory.translate(unit.text, { documentId: `native-library:${paperId}`, pdfPath: source.pdfPath, expectedSignature: source.signature, pageIndex: unit.pageIndex, source: options.source || 'English', target: options.target || 'Chinese', background: true, signal: run.controller.signal });
          results.push({ ...unit, translation: result.translation });
          run.state.completed++; if (result.cached) run.state.cached++;
          await notify(run);
        }
        await writeJson(path.join(directory(paperId), 'translations.json'), { signature: source.signature, source: options.source || 'English', target: options.target || 'Chinese', units: results });
        return `已保存 ${results.length} 段译文，复用 ${run.state.cached} 段缓存`;
      });
      run.state.status = Object.values(run.state.steps).some(step => step.status === 'error') ? 'partial' : 'done';
    } catch (error) { run.state.status = run.controller.signal.aborted ? 'stopped' : 'error'; run.state.message = error.message || String(error); }
    finally { run.state.running = false; run.state.paused = false; try { await notify(run); } finally { runs.delete(paperId); if (active === paperId) active = null; } }
  }
  return {
    async paper_prepared_source({ paperId }) {
      const source = await readJson(path.join(directory(paperId), 'source.json'));
      if (!source) return null;
      const pdfPath = pdfFor(paperFor(paperId)); const stat = await fs.stat(pdfPath);
      return source.signature === hash([pdfPath, stat.size, stat.mtimeMs, stat.ctimeMs]) ? source : null;
    },
    async paper_translation_prefetch({ paperId, pageIndex, source, target, requestId }) {
      paperFor(paperId);
      if (active || !Number.isInteger(pageIndex) || pageIndex < 0 || !(await context.qualityTranslation.status()).ready) return { skipped: true };
      prefetches.get(paperId)?.controller.abort();
      const job = { requestId, controller: new AbortController() }; prefetches.set(paperId, job);
      try {
        const parsed = await sourceFor(paperId);
        const next = parsed.pages[pageIndex + 1]; if (!next) return { skipped: true };
        for (const unit of translationUnits([next])) {
          job.controller.signal.throwIfAborted();
          await context.translationMemory.translate(unit.text, { documentId: `native-library:${paperId}`, pdfPath: parsed.pdfPath, pageIndex: pageIndex + 1, source, target, background: true, signal: job.controller.signal });
        }
        return { completed: true };
      } catch (error) { if (job.controller.signal.aborted) return { cancelled: true }; throw error; }
      finally { if (prefetches.get(paperId) === job) prefetches.delete(paperId); }
    },
    paper_translation_prefetch_cancel({ paperId, requestId }) {
      const job = prefetches.get(paperId); if (job?.requestId === requestId) job.controller.abort();
      return { cancelled: true };
    },
    async quality_translate_block({ text, documentId, pdfPath, source, target }) {
      if (typeof text !== 'string') throw new Error('无效翻译文字。');
      return context.translationMemory.translate(text, { documentId, pdfPath, source, target, background: true });
    },
    async paper_prepare_start({ paperId, mode = 'all', modelOptions, source, target } = {}, event) {
      if (!['all', 'translation'].includes(mode)) throw new Error('未知文献处理方式。');
      pdfFor(paperFor(paperId));
      if (runs.get(paperId) && !runs.get(paperId).state.running) await runs.get(paperId).promise;
      if (runs.has(paperId)) { const run = runs.get(paperId); if (event?.sender) run.senders.add(event.sender); return run.state; }
      if (active) throw new Error('另一篇文献正在处理，请等待完成或暂停后停止，再处理此篇。');
      for (const job of prefetches.values()) job.controller.abort();
      const run = { controller: new AbortController(), senders: new Set(event?.sender ? [event.sender] : []), state: { paperId, status: 'running', running: true, paused: false, stage: 'parse', steps: {}, completed: 0, total: 0, cached: 0 } };
      runs.set(paperId, run); active = paperId;
      try { await notify(run); } catch (error) { runs.delete(paperId); active = null; throw error; }
      run.promise = execute(run, { mode, modelOptions, source, target }).catch(error => console.error('[PaperDesk] preparation state save failed:', error.message));
      return run.state;
    },
    async paper_prepare_status({ paperId }, event) {
      const run = runs.get(paperId);
      if (run && !run.state.running) await run.promise;
      if (run) { if (event?.sender) run.senders.add(event.sender); return run.state; }
      paperFor(paperId); const saved = await readJson(path.join(directory(paperId), 'state.json'));
      if (runs.has(paperId)) return runs.get(paperId).state;
      if (saved?.running) return { ...saved, running: false, paused: false, status: 'stopped', message: '上次处理未完成；已完成译文保留，点击一键处理继续。' };
      return saved;
    },
    async paper_prepare_control({ paperId, action }) {
      const run = runs.get(paperId); if (!run) return null;
      if (action === 'stop') run.controller.abort(new Error('已停止，完成的译文和概览已保留。'));
      else if (action === 'pause' || action === 'resume') run.state.paused = action === 'pause';
      else throw new Error('未知处理操作。');
      await notify(run); return run.state;
    },
    async paper_translation_get({ paperId }) {
      const source = await sourceFor(paperId); const saved = await readJson(path.join(directory(paperId), 'translations.json'));
      return saved?.signature === source.signature ? saved : null;
    },
    async paper_metadata_local({ paperId, modelOptions }) {
      const source = await sourceFor(paperId);
      return commands.extract_metadata_local({ options: { ...modelOptions, text: source.pages[0].map(block => block.content || '').join('\n') } });
    },
  };
}
module.exports = { createPreparationCommands, translationUnits, doiFromText, formatReport };
