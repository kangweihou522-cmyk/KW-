const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const REPORT_PROMPT_VERSION = 'paperdesk-reading-report-v2';
const MAX_EXCERPT_CHARS = 4_000;
const STRING_FIELDS = ['title', 'abstract', 'overview', 'background', 'researchProblem', 'approach', 'experimentSetup', 'dataAnalysis', 'discussion', 'conclusions', 'limitations', 'evidenceEvaluation'];
const ARRAY_FIELDS = ['keyFindings', 'takeaways', 'keywords'];
const MAX_SUPPLEMENT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_SUPPLEMENT_BYTES = 10 * 1024 * 1024;
const MAX_COMBINED_SUPPLEMENT_CHARS = 1_000_000;
const reportsInFlight = new Map();

function splitReportContext(text, maxChars = MAX_EXCERPT_CHARS) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) throw new Error('没有可分析的原文。请先导入并解析 PDF；仅凭标题不能生成有证据的读书报告。');
  const chunks = [];
  let cursor = 0;
  let currentPage = '';
  let currentSource = '';
  while (cursor < source.length) {
    let end = Math.min(cursor + maxChars, source.length);
    if (end < source.length) {
      const newline = source.lastIndexOf('\n', end);
      if (newline > cursor + maxChars / 2) end = newline + 1;
    }
    const part = source.slice(cursor, end);
    const inherited = [currentSource,
      currentPage ? `${currentPage} (continued excerpt; exact page transitions below)` : '',
    ].filter(Boolean).join('\n');
    chunks.push((inherited ? `${inherited}\n` : '') + part);
    for (const label of part.matchAll(/^#+\s*(?:(?:PDF\s+)?Page\s+\d+[^\n]*|(?:Source|Supplement):[^\n]*)/gim)) {
      if (/^#+\s*(?:Source|Supplement):/i.test(label[0])) {
        currentSource = label[0];
        currentPage = '';
      } else currentPage = label[0];
    }
    cursor = end;
  }
  return chunks;
}

async function appendSupplementContext(mainText, options, context, scopeWarnings = []) {
  if (!options.paperId) return mainText;
  const paper = context.store?.load().papers.find((item) => item.id === options.paperId);
  if (!paper) throw new Error('未找到读书报告对应的本地文献，无法核实补充材料归属。');
  const supplements = (paper.attachments ?? []).filter((item) => item.kind === 'supplement');
  if (!supplements.length) return mainText;
  const parts = [`# Source: Main PDF\n${mainText}`];
  let totalChars = 0;
  for (const attachment of supplements) {
    const label = path.basename(attachment.fileName || attachment.storedPath || '未命名补充材料').replace(/[\r\n]/g, ' ');
    const header = `# Supplement: ${label}`;
    if (totalChars >= MAX_COMBINED_SUPPLEMENT_CHARS) {
      scopeWarnings.push(`${label}：补充材料文本超过本次处理上限，未纳入分析。`);
      parts.push(`${header}\n[未纳入分析：补充材料文本超过本次处理上限，请单独阅读此文件。]`);
      continue;
    }
    try {
      if (typeof attachment.storedPath !== 'string' || !path.isAbsolute(attachment.storedPath)) throw new Error('缺少有效本地附件路径。');
      const extension = path.extname(attachment.storedPath).toLowerCase();
      if (extension === '.xlsx') {
        scopeWarnings.push(`${label}：XLSX 工作表仅保管，未纳入分析；请另存 CSV 后重新关联，或人工核对。`);
        parts.push(`${header}\n[仅保存附件，未读取 XLSX 工作表；不能据此报告其中的数值、统计方法或证据。请另存 CSV 后重新关联，或人工核对。]`);
        continue;
      }
      const stat = await fs.stat(attachment.storedPath);
      const limit = extension === '.pdf' ? MAX_SUPPLEMENT_FILE_BYTES : MAX_TEXT_SUPPLEMENT_BYTES;
      if (!stat.isFile() || stat.size > limit) throw new Error(`附件不是文件或超过本地单文件分析大小上限（${limit / 1024 / 1024} MB）。`);
      let text;
      if (extension === '.pdf') {
        const { parseLocalPdf } = require('./localPdfParser.cjs');
        const { addOfflineOcr } = require('./mineruCommands.cjs');
        let parsed;
        try { parsed = await parseLocalPdf(attachment.storedPath); }
        catch (error) {
          if (error.code !== 'LOCAL_OCR_REQUIRED') throw error;
          parsed = { pages: Array.from({ length: error.pageCount || 1 }, () => []), warnings: [], markdown: '', engine: 'pdfjs-local-text', pageCount: error.pageCount || 1 };
        }
        parsed = await addOfflineOcr(parsed, attachment.storedPath);
        text = parsed.markdown;
        if (parsed.warnings?.length) scopeWarnings.push(`${label}：${parsed.warnings.join(' ')}`);
        if (parsed.warnings?.length && !text.includes('[解析范围提示]')) text = `[解析范围提示] ${parsed.warnings.join(' ')}\n\n${text}`;
      } else if (['.txt', '.md', '.csv'].includes(extension)) {
        text = await fs.readFile(attachment.storedPath, 'utf8');
        if (!text.trim()) throw new Error('补充文件为空。');
        text = `[文本补充材料；无 PDF 页码，请用文件名及原始行号引用]\n` + text.split(/\r?\n/).map((line, index) => `L${index + 1}: ${line}`).join('\n');
      } else throw new Error('当前分析仅支持 PDF、TXT、Markdown、CSV；此格式仅保存附件。');
      totalChars += text.length;
      parts.push(`${header}\n${text}`);
    } catch (error) {
      scopeWarnings.push(`${label}：未纳入分析（${String(error.message).replace(/[\r\n]+/g, ' ')}）。`);
      parts.push(`${header}\n[未纳入分析：${String(error.message).replace(/[\r\n]+/g, ' ')} 不能推测此文件中的实验或证据。]`);
    }
  }
  return parts.join('\n\n');
}

function normalizeReport(parsed, options = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('本地模型未返回有效的读书报告 JSON。');
  const knownFields = [...STRING_FIELDS, ...ARRAY_FIELDS].filter((key) => {
    return typeof parsed[key] === 'string' ? parsed[key].trim().length > 0 : Array.isArray(parsed[key]) && parsed[key].length > 0;
  });
  if (knownFields.length < 2) throw new Error('本地模型返回的报告字段不足，未保存为空报告；请重试或选择更合适的本地模型。');
  const missing = /english/i.test(options.outputLanguage || '') ? 'Not reported in the provided source.' : '原文未报告／当前提供的材料不足。';
  const report = {};
  for (const key of STRING_FIELDS) report[key] = typeof parsed[key] === 'string' && parsed[key].trim() ? parsed[key].trim() : missing;
  report.title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : options.title || '';
  for (const key of ARRAY_FIELDS) report[key] = Array.isArray(parsed[key]) ? parsed[key].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()) : [];
  return report;
}

async function cachedReport(directory, identity, create) {
  const hash = crypto.createHash('sha256').update(JSON.stringify({ version: REPORT_PROMPT_VERSION, ...identity })).digest('hex');
  const target = directory ? path.join(directory, `${hash}.json`) : `memory:${hash}`;
  if (reportsInFlight.has(target)) return reportsInFlight.get(target);
  const pending = Promise.resolve().then(async () => {
    if (!directory) return create();
    try {
      const cached = JSON.parse(await fs.readFile(target, 'utf8'));
      if (cached.version === REPORT_PROMPT_VERSION && cached.value && typeof cached.value === 'object') return cached.value;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const value = await create();
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: REPORT_PROMPT_VERSION, value }), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
    return value;
  });
  reportsInFlight.set(target, pending);
  try { return await pending; }
  finally { if (reportsInFlight.get(target) === pending) reportsInFlight.delete(target); }
}

module.exports = { REPORT_PROMPT_VERSION, splitReportContext, appendSupplementContext, normalizeReport, cachedReport };
