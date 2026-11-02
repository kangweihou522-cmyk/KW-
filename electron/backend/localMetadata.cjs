const { normalizeText } = require('./translationMemory.cjs');
function evidenceText(value) { return normalizeText(String(value || '')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function validateMetadata(result, text) {
  const evidence = evidenceText(text); const accepted = {};
  for (const key of ['title', 'publication', 'year', 'volume', 'issue', 'pages', 'publishedDate', 'doi']) {
    const value = result?.[key];
    if (typeof value === 'string' && value.trim() && value.length <= 2000 && evidenceText(value).length > 0 && evidence.includes(evidenceText(value))) accepted[key] = value.trim();
  }
  accepted.authors = (Array.isArray(result?.authors) ? result.authors : []).filter(name => typeof name === 'string' && name.trim().length > 2 && name.length < 250 && !/^(MDPI|Elsevier|Springer|Wiley|Taylor\s*&\s*Francis|Frontiers)$/i.test(name.trim()) && evidence.includes(evidenceText(name)));
  if (accepted.year && !/^(18|19|20)\d{2}$/.test(accepted.year)) delete accepted.year;
  if (accepted.doi && !/^10\.\d{4,9}\/\S+$/i.test(accepted.doi)) delete accepted.doi;
  return accepted;
}
module.exports = { validateMetadata };
