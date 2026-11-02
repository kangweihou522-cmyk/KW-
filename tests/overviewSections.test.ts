import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverviewSections, overviewSectionLabel } from '../src/features/literature/overviewSections.ts';
import { joinEditableReport, splitEditableReport } from '../src/features/reader/reportEditorSections.ts';

test('custom AI overview tabs preserve titles, order, edits, empty sections and repeated headings', () => {
  const original = '## 概览\n\n原始梗概 [PDF Page 1]\n\n## 要点\n\n- n=20\n\n## 重点\n\n核查图2与补充表S1\n\n## 重点\n\n另一项核查\n\n## 待补充\n\n';
  const sections = parseOverviewSections(original);
  assert.deepEqual(sections.map(section => section.title), ['概览', '要点', '重点', '重点', '待补充']);
  assert.equal(new Set(sections.map(section => section.id)).size, 5);
  assert.equal(overviewSectionLabel('重点', 2, (zh: string) => zh), '重点');
  assert.equal(overviewSectionLabel('我的 summary 核查', 2, (zh: string) => zh), '我的 summary 核查');
  assert.match(sections[2].content, /补充表S1/);
  const edited = splitEditableReport(original);
  edited[2] = { ...edited[2], title: '重点与证据', content: '修改后的正文：n=21 [PDF Page 3]\n\n' };
  edited.splice(3, 1);
  const reopened = parseOverviewSections(joinEditableReport(edited));
  assert.deepEqual(reopened.map(section => section.title), ['概览', '要点', '重点与证据', '待补充']);
  assert.match(reopened[2].content, /n=21 \[PDF Page 3\]/);
  assert.match(reopened[0].content, /原始梗概/);
});

test('code examples do not turn into overview tabs and blank saved content has no tabs', () => {
  const sections = parseOverviewSections('## 方法\n\n```md\n## 示例中的标题\n```\n\n## 自定义\n\n文本');
  assert.deepEqual(sections.map(section => section.title), ['方法', '自定义']);
  assert.match(sections[0].content, /## 示例中的标题/);
  assert.deepEqual(parseOverviewSections('  \n'), []);
});
