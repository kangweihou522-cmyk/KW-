import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function loadReport() {
  const directory = await mkdtemp(join(tmpdir(), 'paperdesk-report-ui-'));
  const outfile = join(directory, 'report.mjs');
  await build({ bundle: true, entryPoints: ['src/features/reader/readingReport.ts'], format: 'esm', outfile, platform: 'node' });
  const report = await import(pathToFileURL(outfile).href);
  await rm(directory, { recursive: true, force: true });
  return report;
}

test('reading report preserves evidence in seven editable sections and marks missing material', async () => {
  const report = await loadReport();
  const summary = { title: 'Test', background: 'Background', researchProblem: 'Question', approach: 'Method', experimentSetup: 'Design', dataAnalysis: 'ANOVA [PDF Page 4]', keyFindings: ['Effect = 3 [Supplement A, PDF Page 2]'], discussion: 'Alternative explanation', conclusions: 'Finding', evidenceEvaluation: 'Small sample', limitations: 'No external validation', keywords: [] };
  const sections = report.buildReadingReportSections(summary);
  assert.equal(sections.length, 7);
  assert.equal(sections[2].content, 'ANOVA [PDF Page 4]');
  assert.match(sections[3].content, /Supplement A, PDF Page 2/);
  assert.match(sections[6].content, /Small sample[\s\S]*No external validation/);
  assert.match(report.buildReadingReportSections({ title: 'Empty' })[2].content, /未报道/);
  const request = report.buildReportNoteRequest({ paperId: 'paper-1', title: 'Reading report', text: report.readingReportMarkdown(summary), source: 'local' });
  assert.deepEqual(request.linkedPaperIds, ['paper-1']);
  assert.equal(request.contentJson.type, 'doc');
  assert.match(request.contentText, /尚未人工核对/);
});

test('manual ChatGPT support does not infer a paper from title or interpret pasted HTML', async () => {
  const report = await loadReport();
  const prompt = report.buildChatGptReadingPrompt('Paper title');
  assert.match(prompt, /没有包含论文正文/);
  assert.match(prompt, /不要仅凭标题/);
  assert.match(prompt, /补充材料/);
  const request = report.buildReportNoteRequest({ title: 'Answer', text: '<script>unexpected()</script>\n# My notes', source: 'chatgpt-manual' });
  assert.match(request.contentText, /用户从 ChatGPT 网页手动回填/);
  assert.equal(request.contentJson.content[2].content[0].text, '<script>unexpected()</script>');
  assert.equal(request.contentJson.content[3].type, 'heading');
});
