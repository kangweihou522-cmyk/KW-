function normalizeText(text) {
  return String(text).normalize('NFKC').replace(/([\p{L}])-\r?\n\s*(?=[\p{L}])/gu, '$1').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
function splitSentences(text) {
  const sentences = [];
  for (const part of segmenter.segment(normalizeText(text))) {
    const value = part.segment.trim(); if (!value) continue;
    const last = sentences.at(-1);
    if (last && /(?:\b(?:et al|figs?|eqs?|refs?|dr|prof|no|vol|pp|vs)|\be\.g|\bi\.e)\.$/i.test(last)) sentences[sentences.length - 1] += ` ${value}`;
    else sentences.push(value);
  }
  return sentences;
}
function selectionContext(text, selected) {
  const candidates = splitSentences(text).filter(sentence => sentence.includes(selected));
  return new Set(candidates).size === 1 ? candidates[0] : normalizeText(text);
}
module.exports = { normalizeText, splitSentences, selectionContext };
