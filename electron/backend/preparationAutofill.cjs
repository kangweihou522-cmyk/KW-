const { randomUUID } = require('node:crypto');
const { normalizeText, splitSentences } = require('./translationText.cjs');

const chineseTitleLabels = new Set(['中文标题', '中文题目', '中文题名']);
function titleField(library) {
  return library.settings?.metadataLayout?.customFields?.find(field => chineseTitleLabels.has(field.label.replace(/\s+/gu, '')));
}
function chineseTitleRequest(library, paperId, expectedTitle, translation) {
  const paper = library.papers.find(p => p.id === paperId);
  if (!paper || paper.title !== expectedTitle) throw new Error('生成期间原标题已修改，已保留修改，请再次处理中文标题。');
  const layout = structuredClone(library.settings?.metadataLayout || { hiddenFields: [], customFields: [] });
  let field = titleField(library);
  if (field && paper.customFields?.[field.id]?.trim()) return null;
  if (!field) {
    if (layout.customFields.length >= 64) throw new Error('自定义项目已满，请先腾出一个项目用于中文标题。');
    field = { id: layout.customFields.some(f => f.id === 'custom_chinese_title') ? `custom_${randomUUID()}` : 'custom_chinese_title', label: '中文标题' };
    layout.customFields.push(field);
  }
  return { paperId, metadataLayout: layout, customFields: { ...paper.customFields, [field.id]: translation } };
}

function abstractHeading(text) {
  const clean = String(text).trim();
  if (/^(?:abstract|summary|摘要)[:：]?$/iu.test(clean.replace(/\s/gu, ''))) return '';
  const match = clean.match(/^(?:abstract|summary)\s*[:：]\s*(.+)$/iu) || clean.match(/^(?:ABSTRACT\s+|摘要\s*[:：]?\s*)(.+)$/u);
  return match ? match[1] : null;
}
function isAbstractEnd(text) {
  return /^(?:introduction\s*$|\d+[.、]?\s*introduction\b|key\s*words?\b|copyright\b|©|关键词|引言\s*$|绪论\s*$)/iu.test(text);
}
function extractAbstract(pages, metadataAbstract) {
  for (const [pageIndex, blocks] of pages.slice(0, 3).entries()) {
    for (let index = 0; index < blocks.length; index++) {
      const first = abstractHeading(blocks[index].content || '');
      if (first === null) continue;
      const heading = blocks[index]; const box = heading.bbox;
      const parts = first ? [first] : []; let ended = false;
      const introY = box ? Math.min(...blocks.filter(block => block.bbox && block.bbox[1] > box[3] && /^(?:\d+\.?\s*)?(?:introduction|引言|绪论)\s*$/iu.test(String(block.content || '').trim())).map(block => block.bbox[1])) : Infinity;
      for (const block of blocks.slice(index + 1)) {
        const text = String(block.content || '').trim(); if (!text) continue;
        if (block.bbox && block.bbox[1] >= introY) { ended = true; continue; }
        // Publisher layouts often put ARTICLE INFO / Keywords to the left of
        // ABSTRACT. Keep only the abstract column while retaining PDF order.
        if (box && block.bbox && (block.bbox[0] < box[0] - 28 || block.bbox[1] < box[1] - 3)) continue;
        if (isAbstractEnd(text)) { ended = true; break; }
        parts.push(text);
        if (parts.join(' ').length > 9000) break;
      }
      if (Number.isFinite(introY)) ended = true;
      const text = normalizeText(parts.join('\n'));
      if (ended && text.length >= 40 && text.length <= 9000) return { text, pageIndex };
    }
  }
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = normalizeText(String(metadataAbstract || '').replace(/<[^>]*>/gu, ' ').replace(/&(amp|lt|gt|quot|apos|nbsp);/gu, (_, name) => entities[name]));
  if (text.length >= 40 && text.length <= 9000) return { text, pageIndex: undefined };
  throw new Error('未可靠识别到原文摘要，未用引言或生成概括替代；可在文献信息中补入原文摘要后再处理。');
}
async function translateAbstract(abstract, memory, options) {
  const han = (abstract.text.match(/[\u3400-\u9fff]/gu) || []).length;
  if (han > abstract.text.length * 0.2) return { translation: abstract.text, cached: 0, total: 0 };
  const units = splitSentences(abstract.text); const translated = []; let cached = 0;
  for (const text of units) {
    options.signal?.throwIfAborted();
    const result = await memory.translate(text, { ...options, pageIndex: abstract.pageIndex, source: 'English', target: 'Chinese', background: true });
    translated.push(result.translation.trim()); if (result.cached) cached++;
  }
  return { translation: translated.join(''), cached, total: units.length };
}
module.exports = { titleField, chineseTitleRequest, extractAbstract, translateAbstract };
