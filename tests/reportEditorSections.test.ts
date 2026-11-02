import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEditableReport, joinEditableReport } from '../src/features/reader/reportEditorSections.ts';
test('section editing preserves evidence, Unicode, custom headings and headings inside fenced examples', () => {
  const text='200–300字梗概：虚构样本。\n\n## 1. 方法\n\nn=20 [PDF Page 3]\n\n```md\n# This is evidence, not a section\n```\n\n## 自定义\n\nα = 0.05';
  const sections=splitEditableReport(text);assert.equal(sections.length,3);assert.equal(joinEditableReport(sections),text);
  sections[1].title='方法与设计';sections[1].content+='手工补充';const edited=joinEditableReport(sections);assert(edited.includes('[PDF Page 3]'));assert(edited.includes('α = 0.05'));assert(edited.includes('## 方法与设计'));assert.equal(splitEditableReport(edited).length,3);
});
