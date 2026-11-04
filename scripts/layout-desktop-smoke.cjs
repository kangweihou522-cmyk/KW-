const assert = require('node:assert/strict');
const path = require('node:path');

async function drag(page, locator, dx, dy) {
  await locator.scrollIntoViewIfNeeded(); const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(350);
}
async function verifyFlexibleLayout(page, home) {
  const right = page.getByRole('separator', { name: '拖动调整详情面板宽度', exact: true });
  const navigation = page.getByRole('separator', { name: '拖动调整本地文库导航宽度', exact: true });
  const details = page.locator('[data-paper-details]');
  await drag(page, right, -350, 0);
  assert((await details.boundingBox()).width > 760, 'Details still have the old 760px cap.');
  await page.reload(); await right.waitFor();
  assert((await details.boundingBox()).width > 760, 'Dragged width was not restored.');
  await right.dblclick(); await page.waitForTimeout(350);
  await drag(page, navigation, 280, 0);
  const width = await navigation.evaluate(element => element.getBoundingClientRect().left - element.parentElement.getBoundingClientRect().left + 8);
  assert(width > 420, 'Navigation still has the old 420px/20% cap.');
  for (const [name, label, dy] of [['personal', '我的文献概览', -100], ['ai', 'AI 概览', -120]]) {
    const panel = page.locator(`[data-paper-details] [data-resizable-overview="${name}"]`);
    const handle = panel.getByRole('separator', { name: `调整${label}高度`, exact: true });
    const before = (await panel.boundingBox()).height;
    await drag(page, handle, 0, dy);
    const after = (await panel.boundingBox()).height;
    assert(Math.abs(after - before - dy) <= 2, `${label} drag did not change height.`);
    await handle.focus(); await page.keyboard.press('ArrowDown');
    assert(Math.abs((await panel.boundingBox()).height - after - 24) <= 2);
  }
  await page.reload(); await details.waitFor();
  assert.equal(Math.round((await details.locator('[data-resizable-overview="personal"]').boundingBox()).height), 304);
  assert.equal(Math.round((await details.locator('[data-resizable-overview="ai"]').boundingBox()).height), 344);
  await page.screenshot({ path: path.join(home, 'adjustable-overview-layout.png') });
  await navigation.dblclick();
  for (const name of ['personal', 'ai']) await details.locator(`[data-resizable-overview="${name}"]`).getByRole('separator').dblclick();
  console.log('PASS actual drag/keyboard/reload: both column widths exceed former caps; personal and AI overview heights persist independently.');
}

async function verifyPdfSelectionAndDpi(page, app, home) {
  // Earlier checks saved highlights over sample/treatment. Use the two clean
  // lines so existing annotation hit targets do not intercept native selection.
  const sample = page.locator('.textLayer span').filter({ hasText: 'The control group included 20 participants.' }).first();
  await sample.waitFor();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const before = await app.evaluate(() => globalThis.workflowModelCalls);
  await sample.click(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString() || ''), '');
  assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), before, 'Single click triggered block translation.');
  await sample.click({ button: 'right' });
  await page.getByText('翻译此段', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  const point = await sample.evaluate(element => {
    const node = element.firstChild; const start = node.textContent.indexOf('control');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 7);
    const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForFunction(() => window.getSelection()?.toString().trim() === 'control');
  await page.locator('[data-selection-translation]').getByText('对照', { exact: true }).waitFor();

  const callsBeforeRange = await app.evaluate(() => globalThis.workflowModelCalls);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.waitForTimeout(300);
  const treatment = page.locator('.textLayer span').filter({ hasText: 'The study does not establish causality.' }).first();
  const first = await sample.boundingBox(), last = await treatment.boundingBox();
  await page.mouse.move(first.x + 0.5, first.y + first.height / 2); await page.mouse.down();
  await page.mouse.move(last.x + last.width - 0.5, last.y + last.height / 2, { steps: 20 }); await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection().toString().replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(home, 'pdf-native-multi-line-selection.png') });
  assert.equal(selected, 'The control group included 20 participants. The study does not establish causality.');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-selection-translation]')?.textContent || '';
    return text.includes('测试离线译文：样本量为20，未证明因果关系。') && text.includes('该研究未建立因果关系。');
  });
  assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), callsBeforeRange, 'An exact cached range invoked the model again.');
  console.log('PASS real multi-line drag: only both selected sentences shown, composed from full-translation cache without model inference.');

  const session = await page.context().newCDPSession(page);
  try {
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await session.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 2, mobile: false });
    for (let n = 0; n < 3; n++) await page.getByLabel('放大', { exact: true }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.pdfViewer .page .canvasWrapper canvas');
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return canvas.width * canvas.height > 5242880 && canvas.width / rect.width >= 1.9 && canvas.height / rect.height >= 1.9;
    }, null, { timeout: 15000 });
    const pixels = await page.locator('.pdfViewer .page .canvasWrapper canvas').first().evaluate(canvas => ({ width: canvas.width, height: canvas.height, cssWidth: canvas.getBoundingClientRect().width, dpr: devicePixelRatio }));
    console.log('PASS real PDF canvas at DPR=2 exceeds the old 5MP cap without undersampling:', JSON.stringify(pixels));
    await page.screenshot({ path: path.join(home, 'pdf-high-dpi-rendering.png') });
    for (let n = 0; n < 3; n++) await page.getByLabel('缩小', { exact: true }).click();
  } finally { await session.send('Emulation.clearDeviceMetricsOverride'); await session.detach(); }
  console.log('PASS native PDF selection: single click selects nothing; double click selects a word; paragraph translation is explicit in the context menu.');
}
module.exports = { verifyFlexibleLayout, verifyPdfSelectionAndDpi };
