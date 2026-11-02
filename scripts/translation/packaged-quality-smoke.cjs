const assert = require('node:assert/strict');

/** Real packaged ASAR + Chromium proxy + interrupted official model download + inference. */
async function verifyPackagedQuality(app, page) {
  await page.locator('[data-paper-row-id]').first().dblclick();
  const channel = page.getByRole('combobox', { name: '划词翻译渠道', exact: true });
  if (!await channel.isVisible()) await page.getByRole('button', { name: '实时翻译', exact: true }).click();
  await channel.selectOption('offline-quality');
  const state = () => page.evaluate(() => window.paperquay.invoke('quality_translation_status'));
  const installButton = () => page.getByRole('button', { name: /^(下载并启用 Hy-MT2 Q4|检查并继续)/ });
  async function waitStopped() {
    await page.waitForFunction(async () => !(await window.paperquay.invoke('quality_translation_status')).installing, null, { timeout: 180000 });
  }
  async function setProxy(broken) {
    await app.evaluate(async ({ session }, broken) => {
      await session.defaultSession.setProxy(broken ? { proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' } : { mode: 'direct' });
      await session.defaultSession.closeAllConnections();
    }, broken);
  }
  try {
    await setProxy(true);
    await installButton().click();
    await page.getByText(/模型下载未完成（huggingface.co/).first().waitFor({ timeout: 30000 });
    const failed = await state();
    assert.equal(failed.ready, false); assert.equal(failed.errorPhase, 'download');
    console.log('PASS packaged model download follows Chromium session proxy and reports its connection failure.');
    await setProxy(false);
    await installButton().click();
    await page.getByRole('progressbar', { name: '模型下载进度', exact: true }).waitFor({ timeout: 90000 });
    await page.waitForFunction(async () => (await window.paperquay.invoke('quality_translation_status')).progress?.received >= 1048576, null, { timeout: 90000 });
    await page.getByRole('button', { name: '暂停下载（保留进度）', exact: true }).click();
    await waitStopped();
    const partial = await state();
    assert(partial.partialBytes > 0 && partial.partialBytes < partial.expectedBytes, 'Paused model prefix was not preserved.');
    console.log('PASS actual packaged UI progress and pause retained bytes:', partial.partialBytes);
    await installButton().click();
    await page.waitForFunction(async () => { const current = await window.paperquay.invoke('quality_translation_status'); return !current.installing && current.ready && !!current.backend; }, null, { timeout: 180000 });
    const ready = await state();
    assert.equal(ready.bytes, 1133080448); assert.equal(ready.partialBytes, 0); assert(ready.backend);
    const translated = await page.evaluate(() => window.paperquay.invoke('selection_translate', { text: 'The sample size was 20.', source: 'English', target: 'Chinese', provider: 'offline-quality', requestId: 'packaged-real-quality' }));
    assert.match(translated.translation, /20/); assert.match(translated.translation, /[\u3400-\u9fff]/);
    console.log('PASS actual packaged resume, ASAR license/manifest registration and inference:', translated.translation);
    // Healthy-model repair must work while downloads are unavailable, proving no duplicate 1.13GB transfer.
    await setProxy(true);
    const repaired = await page.evaluate(() => window.paperquay.invoke('quality_translation_install', { force: true }));
    assert.equal(repaired.ready, true); assert.equal(repaired.bytes, ready.bytes); assert.equal(repaired.progress.message, '已复用完整模型并启用');
    console.log('PASS packaged repair reused verified weights with download network unavailable.');
  } finally { await setProxy(false); }
}
module.exports = { verifyPackagedQuality };
