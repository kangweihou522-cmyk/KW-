import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatGptReadingPrompt,
  buildReadingReportSections,
  buildReportNoteRequest,
  readingReportMarkdown,
  textToNoteDocument,
} from '../src/features/reader/readingReport.ts';
import type { PaperSummary } from '../src/types/reader.ts';

const summary: PaperSummary = {
  title: 'Local paper', abstract: 'Abstract', overview: 'Overview',
  background: 'Background [Page 1]', researchProblem: 'Question',
  approach: 'Randomized', experimentSetup: 'n=20',
  keyFindings: ['Effect 1.2 mg/L (Fig. 2, Page 5)'],
  conclusions: 'Conclusion', limitations: 'Limited sample',
  keywords: ['test'], takeaways: [],
  dataAnalysis: 't-test, p=0.03', discussion: 'Alternative explanation',
  evidenceEvaluation: 'Bias remains possible',
};

test('reading report contains the seven requested sections and preserves evidence', () => {
  const sections = buildReadingReportSections(summary);
  assert.deepEqual(sections.map((section) => section.title), [
    '背景与问题', '试验方法设计', '数据分析处理', '主要结果与证据',
    '讨论与整合', '主要结论', '证据评价及局限',
  ]);
  assert.match(sections[0].content, /Background \[Page 1\][\s\S]*Question/);
  assert.equal(sections[3].content, '- Effect 1.2 mg/L (Fig. 2, Page 5)');
  assert.match(sections[6].content, /Bias remains possible[\s\S]*Limited sample/);
  assert.match(readingReportMarkdown(summary), /尚未人工核对/);
});

test('legacy cached summaries explicitly leave unreported fields unfilled', () => {
  const sections = buildReadingReportSections({ ...summary, dataAnalysis: undefined, discussion: undefined, evidenceEvaluation: undefined });
  assert.match(sections[2].content, /未报道或当前材料不足/);
  assert.match(sections[4].content, /未报道或当前材料不足/);
  assert.equal(sections[6].content, 'Limited sample');
});

test('manual ChatGPT prompt requires attached source material and evidence without claiming uploaded text', () => {
  const prompt = buildChatGptReadingPrompt('Example title');
  assert.match(prompt, /没有包含论文正文/);
  assert.match(prompt, /若我尚未附上 PDF/);
  assert.match(prompt, /页码、图号或表号/);
  assert.match(prompt, /不要编造/);
  assert.match(prompt, /Example title/);
});

test('report notes remain editable and treat pasted HTML as text', () => {
  const malicious = '<script>alert("x")</script>\n# Header\n<img src="https://example.com/pixel">';
  const doc = textToNoteDocument(malicious);
  assert.equal(doc.content?.[0].type, 'paragraph');
  assert.equal(doc.content?.[0].content?.[0].text, '<script>alert("x")</script>');
  assert.equal(doc.content?.[1].type, 'heading');
  assert.equal(doc.content?.[2].content?.[0].type, 'text');
  const note = buildReportNoteRequest({ paperId: 'paper-123', title: 'Report', text: malicious, source: 'chatgpt-manual' });
  assert.equal(note.linkedPaperId, 'paper-123');
  assert.equal(note.type, 'ai-chat');
  assert.match(note.contentText || '', /用户从 ChatGPT 网页手动回填/);
  assert.equal(note.contentHtml, undefined);
  assert.equal(note.contentJson?.type, 'doc');
});
