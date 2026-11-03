const DEFAULT_SECTIONS = [
  { id: 'overview', title: '文献概览', content: '' },
  { id: 'team', title: '团队简介', content: '' },
  { id: 'abstract', title: '摘要', content: '' },
];
const countCharacters = text => Array.from(String(text).replace(/\s/gu, '')).length;
function sectionsFor(document) {
  if (document.content === null || document.content === undefined) return structuredClone(DEFAULT_SECTIONS);
  if (!Array.isArray(document.content) || !document.content.every(section => typeof section.id === 'string' && typeof section.content === 'string')) throw new Error('概览格式异常，未自动改写，请先核对历史版本。');
  return document.content;
}
function neededFields(document) {
  // A draft may contain deletions as well as new text. Leave the whole draft's
  // base document alone until the user saves or recovers it.
  if (document.drafts?.length) return [];
  return sectionsFor(document).filter(section => ['overview', 'abstract'].includes(section.id) && !section.content.trim()).map(section => section.id);
}
function validatePersonalOverview(value, fields) {
  const result = {};
  for (const field of fields) {
    const text = typeof value?.[field] === 'string' ? value[field].trim() : '';
    if (!text || /^(?:原文未报告|材料不足|尚未填写)/u.test(text)) throw new Error('模型未生成有效摘要或文章概括，未填入空内容。');
    if (field === 'overview' && (countCharacters(text) < 1000 || countCharacters(text) > 1500)) throw new Error(`文章概括为 ${countCharacters(text)} 字，未达到 1000–1500 字要求，未填入；可再次一键处理重试。`);
    result[field] = text;
  }
  return result;
}
function fillBlankSections(noteStore, paperId, generated) {
  // This synchronous read/merge/CAS write cannot overwrite an edit committed
  // while inference was running. Removed sections are never recreated.
  const latest = noteStore.getDocument(paperId, 'overview');
  const needed = neededFields(latest);
  const filled = needed.filter(field => generated[field]?.trim());
  if (!filled.length) return { filled, document: latest };
  const content = sectionsFor(latest).map(section => filled.includes(section.id) ? { ...section, content: generated[section.id] } : section);
  const document = noteStore.saveDocument({ paperId, kind: 'overview', content, expectedVersion: latest.version, sourceId: 'paperdesk:auto-overview' });
  return { filled, document };
}
module.exports = { countCharacters, neededFields, validatePersonalOverview, fillBlankSections };
