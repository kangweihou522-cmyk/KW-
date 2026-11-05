const test = require('node:test'); const assert = require('node:assert/strict');
const { extractOverviewResponse: extract } = require('../electron/backend/overviewResponse.cjs');
test('overview accepts aliases, body lists, nested sections, plain text and finished reasoning wrappers', () => {
  for (const value of [{ overview: '研究结果。' }, { summary: '研究结果。' }, { 概括: '研究结果。' }, { content: { text: '研究结果。' } }]) assert.equal(extract(JSON.stringify(value)).overview, '研究结果。');
  assert.equal(extract('{"overview":["背景。","结果。"]}').overview, '背景。\n\n结果。');
  assert.equal(extract('{"sections":[{"heading":"背景","content":"正文。"},{"text":"结论。"}]}').overview, '正文。\n\n结论。');
  assert.equal(extract('<think>不要显示的思考</think>\n```json\n{"summary":"研究结果。"}\n```').overview, '研究结果。');
  assert.equal(extract('直接输出的概括正文。').overview, '直接输出的概括正文。');
  assert.equal(extract('以下是概括：\n```json\n{"summary":"研究正文。"}\n```').overview, '研究正文。');
  assert.equal(extract('以下是结果：{"summary":"研究正文。"}').overview, '研究正文。');
});
test('overview rejects unknown objects, incomplete JSON, placeholders and unfinished reasoning', () => {
  for (const raw of ['{"title":"仅标题"}', '{"error":"请求失败"}', '{"overview":"', '<think>未完成的思考', '{"overview":"材料不足"}', 'Error: model failed', '请求失败：模型异常', '']) assert.throws(() => extract(raw));
});
test('Qwen closing-only reasoning boundary keeps only the final answer', () => {
  assert.equal(extract('内部推演，不得保存。\n</think>\n最终概括正文。').overview, '最终概括正文。');
  assert.equal(extract('</THINK>\n```json\n{"overview":"最终概括正文。"}\n```').overview, '最终概括正文。');
  assert.equal(extract('内部推演</think><think>后续推演</think>最终正文。').overview, '最终正文。');
  assert.equal(extract(JSON.stringify({ overview: '<think>内部推演</think>最终正文。' })).overview, '最终正文。');
  for (const raw of ['内部推演</think>', '内部推演</think><think>再次思考未结束', '<think>思考未结束但包含貌似正文的文字。']) assert.throws(() => extract(raw));
});
