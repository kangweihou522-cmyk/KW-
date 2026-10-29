// PaperDesk additions. EndNote exchange is file based; original libraries are never modified.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { DOMParser } = require('@xmldom/xmldom');
const { normalizeAuthor, normalizeTag } = require('./libraryStore.cjs');
const { cleanString, hashFile, id, now, safeFileName } = require('./utils.cjs');

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 10000;
const SUPPLEMENT_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.csv', '.xlsx']);
const mimeTypes = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function boundedText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请提供非空的本地文件内容。');
  if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) throw new Error('交换文件超过 10 MB，请分批导入。');
  return value.replace(/^\uFEFF/, '');
}

function normalizeDoi(value) {
  return cleanString(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim().toLowerCase();
}

function matchingTitle(value) {
  return cleanString(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function nullable(value) { return cleanString(value) || null; }
function yearFrom(value) { return cleanString(value).match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? null; }
function texts(element, tagName) { return Array.from(element.getElementsByTagName(tagName)).map((node) => cleanString(node.textContent)).filter(Boolean); }
function firstText(element, ...tags) { return tags.map((tag) => texts(element, tag)[0]).find(Boolean) || ''; }

function parseEndNoteXml(input) {
  const text = boundedText(input);
  // EndNote exports need no DTD. Reject entity declarations before parsing, even
  // though xmldom does not fetch external entities, to keep imports non-networked.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('不接受包含 DTD 或实体声明的 XML；请重新导出标准 EndNote XML。');
  const errors = [];
  const document = new DOMParser({
    onError(level, message) { if (level === 'error' || level === 'fatalError') errors.push(message); },
  }).parseFromString(text, 'text/xml');
  if (errors.length || !document?.documentElement || document.getElementsByTagName('parsererror').length) throw new Error('EndNote XML 格式无效。');
  const records = Array.from(document.getElementsByTagName('record'));
  if (!records.length) throw new Error('XML 中未找到 EndNote record 记录。');
  if (records.length > MAX_RECORDS) throw new Error('文献记录超过 10000 条，请分批导出。');
  return records.map((record, index) => {
    const title = firstText(record, 'title');
    if (!title) throw new Error(`第 ${index + 1} 条文献缺少标题，未导入任何记录。`);
    return {
      title,
      authors: texts(record, 'author'),
      year: yearFrom(firstText(record, 'year', 'date')),
      publication: nullable(firstText(record, 'secondary-title', 'full-title', 'periodical')),
      doi: nullable(normalizeDoi(firstText(record, 'electronic-resource-num', 'doi'))),
      url: nullable(texts(record, 'url').find((url) => /^https?:\/\//i.test(url))),
      abstractText: nullable(firstText(record, 'abstract')),
      userNote: nullable([firstText(record, 'research-notes'), firstText(record, 'notes')].filter(Boolean).join('\n\n')),
      keywords: texts(record, 'keyword'),
      attachmentPaths: texts(record, 'url').filter((url) => /^(?:internal-pdf:|file:|[A-Za-z]:[\\/]|\/)/i.test(url)),
    };
  });
}

function parseRis(input) {
  const lines = boundedText(input).split(/\r?\n/);
  const records = [];
  let fields = null;
  let currentTag = '';
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/);
    if (!match) {
      if (line.trim() && fields && currentTag) fields[currentTag][fields[currentTag].length - 1] += `\n${line.trim()}`;
      continue;
    }
    const [, tag, value] = match;
    if (tag === 'TY') {
      if (fields) throw new Error('RIS 上一条记录缺少 ER 结束标记。');
      fields = {};
    } else if (tag === 'ER') {
      if (!fields) throw new Error('RIS 记录缺少 TY 起始标记。');
      const title = fields.TI?.[0] || fields.T1?.[0] || fields.CT?.[0];
      if (!title?.trim()) throw new Error(`第 ${records.length + 1} 条 RIS 文献缺少标题。`);
      records.push({
        title: title.trim(), authors: [...(fields.AU ?? []), ...(fields.A1 ?? [])],
        year: yearFrom(fields.PY?.[0] || fields.Y1?.[0] || ''),
        publication: nullable(fields.JO?.[0] || fields.JF?.[0] || fields.T2?.[0]),
        doi: nullable(normalizeDoi(fields.DO?.[0])), url: nullable(fields.UR?.[0]),
        abstractText: nullable(fields.AB?.[0] || fields.N2?.[0]),
        userNote: nullable((fields.N1 ?? []).join('\n\n')),
        keywords: fields.KW ?? [], attachmentPaths: fields.L1 ?? [],
      });
      fields = null;
      if (records.length > MAX_RECORDS) throw new Error('文献记录超过 10000 条，请分批导入。');
    } else if (fields) {
      (fields[tag] ??= []).push(value.trim());
      currentTag = tag;
    }
  }
  if (fields) throw new Error('RIS 最后一条记录缺少 ER 结束标记。');
  if (!records.length) throw new Error('未找到有效的 RIS 记录。');
  return records;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function exportEndNoteXml(papers) {
  const tag = (name, value) => value == null || value === '' ? '' : `<${name}>${xmlEscape(value)}</${name}>`;
  const records = papers.map((paper, index) => `<record>${tag('rec-number', index + 1)}<ref-type name="Journal Article">17</ref-type><contributors><authors>${(paper.authors ?? []).map((author) => tag('author', author.name)).join('')}</authors></contributors><titles>${tag('title', paper.title)}${tag('secondary-title', paper.publication)}</titles><dates>${tag('year', paper.year)}</dates>${tag('electronic-resource-num', paper.doi)}${tag('abstract', paper.abstractText)}${tag('research-notes', paper.userNote)}<keywords>${(paper.keywords ?? []).map((word) => tag('keyword', word)).join('')}</keywords><urls><web-urls>${tag('url', paper.url)}</web-urls><pdf-urls>${(paper.attachments ?? []).filter((attachment) => attachment.kind === 'pdf').map((attachment) => tag('url', attachment.storedPath)).join('')}</pdf-urls></urls></record>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>${records.join('\n')}</records></xml>\n`;
}

function exportRis(papers) {
  const line = (tag, value) => value == null || value === '' ? '' : `${tag}  - ${String(value).replace(/\r?\n/g, '\n      ')}\n`;
  return papers.map((paper) => 'TY  - JOUR\n' + line('TI', paper.title) + (paper.authors ?? []).map((author) => line('AU', author.name)).join('') + line('PY', paper.year) + line('JO', paper.publication) + line('DO', paper.doi) + line('UR', paper.url) + line('AB', paper.abstractText) + line('N1', paper.userNote) + (paper.keywords ?? []).map((word) => line('KW', word)).join('') + (paper.attachments ?? []).filter((attachment) => attachment.kind === 'pdf').map((attachment) => line('L1', attachment.storedPath)).join('') + 'ER  - \n').join('\n');
}

function parseCsv(input) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const text = boundedText(input);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted || cell === '') quoted = !quoted;
      else throw new Error('CSV 引号格式无效。');
    } else if (!quoted && (character === ',' || character === '\n' || character === '\r')) {
      row.push(cell); cell = '';
      if (character !== ',') {
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      }
    } else cell += character;
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV 应包含字段名及至少一条数据。');
  const headers = rows.shift().map((value) => value.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) throw new Error('CSV 字段名不可为空或重复。');
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error('CSV 每行字段数必须与表头一致。');
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
  });
}

function normalizeMetrics(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_RECORDS) throw new Error('期刊指标应为 1–10000 条记录的数组。');
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`第 ${index + 1} 条期刊指标无效。`);
    const journal = cleanString(row.journal);
    const issn = cleanString(row.issn).toUpperCase();
    const source = cleanString(row.source);
    const year = Number(row.year);
    if (!journal && !/^\d{4}-\d{3}[\dX]$/.test(issn)) throw new Error(`第 ${index + 1} 条指标需要期刊名称或有效 ISSN。`);
    if (issn && !/^\d{4}-\d{3}[\dX]$/.test(issn)) throw new Error(`第 ${index + 1} 条 ISSN 格式应为 1234-567X。`);
    if (!Number.isInteger(year) || year < 1900 || year > 2200 || !source) throw new Error(`第 ${index + 1} 条指标必须填写有效年度及数据来源。`);
    const missing = (value) => value == null || /^(?:|n\/?a|unknown|null|-|未知|未查询)$/i.test(String(value).trim());
    const impactFactor = missing(row.impactFactor) ? null : Number(row.impactFactor);
    const jcrQuartile = missing(row.jcrQuartile) ? null : cleanString(row.jcrQuartile).toUpperCase();
    const casPartition = missing(row.casPartition) ? null : Number(row.casPartition);
    if (impactFactor !== null && (!Number.isFinite(impactFactor) || impactFactor < 0)) throw new Error(`第 ${index + 1} 条影响因子无效。`);
    if (jcrQuartile !== null && !/^Q[1-4]$/.test(jcrQuartile)) throw new Error(`第 ${index + 1} 条 JCR 分区应为 Q1–Q4 或留空。`);
    if (casPartition !== null && ![1, 2, 3, 4].includes(casPartition)) throw new Error(`第 ${index + 1} 条中科院分区应为 1–4 或留空。`);
    return { journal, issn: issn || null, year, source, category: nullable(row.category), impactFactor, jcrQuartile, casPartition, updatedAt: now() };
  });
}

function metricKey(row) { return JSON.stringify([matchingTitle(row.journal), row.issn, row.year, row.source, row.category]); }

async function copyAttachment(sourcePath, paper, library, kind) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!SUPPLEMENT_EXTENSIONS.has(extension) || (kind === 'pdf' && extension !== '.pdf')) throw new Error('仅支持本地 PDF、TXT、Markdown、CSV、XLSX 附件。');
  const stat = await fsp.stat(sourcePath);
  if (!stat.isFile()) throw new Error('附件路径必须指向文件。');
  const contentHash = await hashFile(sourcePath);
  if (paper.attachments.some((attachment) => attachment.contentHash === contentHash)) return null;
  const storageDir = path.resolve(library.settings.storageDir);
  const directory = path.join(storageDir, safeFileName(paper.id), kind === 'supplement' ? 'supplements' : 'pdf');
  await fsp.mkdir(directory, { recursive: true });
  const fileName = safeFileName(path.basename(sourcePath));
  const storedPath = path.join(directory, `${id('file')}_${fileName}`);
  await fsp.copyFile(sourcePath, storedPath, fs.constants.COPYFILE_EXCL);
  const attachment = { id: id('att'), paperId: paper.id, kind, originalPath: sourcePath, storedPath, relativePath: path.relative(storageDir, storedPath), fileName, mimeType: mimeTypes[extension], fileSize: stat.size, contentHash, createdAt: now(), missing: false };
  paper.attachments.push(attachment);
  return attachment;
}

function resolveAttachmentReference(reference, baseDirectory) {
  const value = cleanString(reference);
  if (/^file:\/\//i.test(value)) return fileURLToPath(value);
  if (/^internal-pdf:\/\//i.test(value)) {
    if (!baseDirectory) return null;
    const relative = decodeURIComponent(value.replace(/^internal-pdf:\/\//i, ''));
    const base = path.resolve(baseDirectory);
    const resolved = path.resolve(base, relative);
    const difference = path.relative(base, resolved);
    if (difference.startsWith('..') || path.isAbsolute(difference)) throw new Error('附件引用超出指定 EndNote PDF 目录。');
    return resolved;
  }
  return path.isAbsolute(value) ? value : null;
}

function createReferenceExchangeCommands({ store, appPaths, shell: suppliedShell }) {
  const metricsPath = path.join(appPaths.dataDir, 'journal-metrics.json');
  function readMetrics() {
    if (!fs.existsSync(metricsPath)) return [];
    const rows = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('本地期刊指标文件格式无效，请从备份恢复。');
    return rows;
  }

  return {
    async library_import_references({ format, content, attachmentBaseDir = '' }) {
      const records = format === 'ris' ? parseRis(content) : format === 'endnote-xml' ? parseEndNoteXml(content) : (() => { throw new Error('仅支持 RIS 或 EndNote XML。'); })();
      const library = store.load();
      let imported = 0, skipped = 0;
      const warnings = [];
      for (const record of records) {
        const duplicate = library.papers.some((paper) => record.doi && paper.doi ? normalizeDoi(paper.doi) === record.doi : matchingTitle(paper.title) === matchingTitle(record.title) && paper.year === record.year);
        if (duplicate) { skipped += 1; continue; }
        const timestamp = now();
        const paper = {
          id: id('paper'), title: record.title, year: record.year, publication: record.publication,
          doi: record.doi, url: record.url, abstractText: record.abstractText,
          userNote: record.userNote, keywords: record.keywords,
          importedAt: timestamp, updatedAt: timestamp, lastReadAt: null,
          readingProgress: 0, isFavorite: false, aiSummary: null, citation: null,
          source: 'endnote-file', sortOrder: -(timestamp + imported),
          authors: record.authors.map(normalizeAuthor), tags: [normalizeTag('EndNote 导入')],
          categoryIds: [], attachments: [],
        };
        for (const reference of record.attachmentPaths) {
          try {
            const localPath = resolveAttachmentReference(reference, attachmentBaseDir);
            if (!localPath) { warnings.push(`${record.title}：附件引用需指定本地 PDF 目录，或为不支持的远程路径。`); continue; }
            await copyAttachment(localPath, paper, library, 'pdf');
          } catch (error) { warnings.push(`${record.title}：附件未复制（${error.message}）。`); }
        }
        library.papers.push(paper);
        imported += 1;
      }
      await store.save(library);
      return { imported, skipped, warnings };
    },

    async library_export_references({ format, paperIds }) {
      const selected = Array.isArray(paperIds) && paperIds.length ? new Set(paperIds) : null;
      const papers = store.load().papers.filter((paper) => !selected || selected.has(paper.id));
      if (format === 'ris') return exportRis(papers);
      if (format === 'endnote-xml') return exportEndNoteXml(papers);
      throw new Error('仅支持 RIS 或 EndNote XML。');
    },

    async library_add_supplement({ paperId, paths }) {
      if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请选择 1–100 个补充文件。');
      const library = store.load();
      const paper = library.papers.find((item) => item.id === paperId);
      if (!paper) throw new Error('文献不存在。');
      // Validate the complete batch before copying so unsupported selections do not
      // create a partly saved collection of attachments.
      for (const filePath of paths) {
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !SUPPLEMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('请选择本地 PDF、TXT、Markdown、CSV、XLSX 文件。');
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) throw new Error('补充材料必须为文件。');
      }
      const copied = [];
      try {
        for (const filePath of paths) {
          const attachment = await copyAttachment(filePath, paper, library, 'supplement');
          if (attachment) copied.push(attachment.storedPath);
        }
        if (copied.length) paper.aiSummary = null;
        paper.updatedAt = now();
        await store.save(library);
      } catch (error) {
        await Promise.all(copied.map((filePath) => fsp.rm(filePath, { force: true })));
        throw error;
      }
      return paper;
    },

    async open_library_attachment({ paperId, attachmentId }) {
      const paper = store.load().papers.find((item) => item.id === paperId);
      const attachment = paper?.attachments.find((item) => item.id === attachmentId);
      if (!attachment) throw new Error('未找到此文献的附件。');
      const filePath = attachment.storedPath;
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
          !SUPPLEMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        throw new Error('仅可打开文献库中已保存的 PDF、TXT、Markdown、CSV、XLSX 附件。');
      }
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat?.isFile()) throw new Error('附件文件不存在，请重新关联本地文件。');
      const shell = suppliedShell ?? require('electron').shell;
      const error = await shell.openPath(filePath);
      if (error) throw new Error(`系统无法打开此附件：${error}`);
      return { opened: true };
    },

    async library_import_journal_metrics({ content, format = 'json' }) {
      const input = boundedText(content);
      const rows = normalizeMetrics(format === 'csv' ? parseCsv(input) : JSON.parse(input));
      const merged = new Map(readMetrics().map((row) => [metricKey(row), row]));
      for (const row of rows) merged.set(metricKey(row), row);
      await fsp.mkdir(path.dirname(metricsPath), { recursive: true });
      const temporaryPath = `${metricsPath}.${id('write')}.tmp`;
      try {
        await fsp.writeFile(temporaryPath, JSON.stringify([...merged.values()], null, 2), 'utf8');
        await fsp.rename(temporaryPath, metricsPath);
      } finally { await fsp.rm(temporaryPath, { force: true }); }
      return { imported: rows.length, total: merged.size };
    },

    async library_reveal_pdf({ paperId } = {}) {
      const library = store.load();
      const paper = library.papers.find((item) => item.id === paperId);
      const attachment = paper?.attachments.find((item) => item.kind === 'pdf');
      const filePath = attachment?.storedPath;
      if (!filePath || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('此文献未登记本地 PDF。');
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat?.isFile()) throw new Error('PDF 文件不存在，请重新关联。');
      (suppliedShell ?? require('electron').shell).showItemInFolder(filePath);
    },

    async library_get_journal_metrics({ journal = '', issn = '', year = null } = {}) {
      return readMetrics().filter((row) => (!journal && !issn) || (journal && matchingTitle(row.journal) === matchingTitle(journal)) || (issn && row.issn === cleanString(issn).toUpperCase()))
        .filter((row) => year == null || row.year === Number(year))
        .sort((left, right) => right.year - left.year || left.journal.localeCompare(right.journal));
    },
  };
}

module.exports = { createReferenceExchangeCommands, parseEndNoteXml, parseRis, exportEndNoteXml, exportRis, normalizeMetrics, parseCsv };
