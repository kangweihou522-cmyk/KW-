const assert = require('node:assert/strict');
const { MODEL_DOWNLOAD_PARTITION } = require('../../electron/backend/modelDownload.cjs');

/** Real packaged ASAR + Chromium proxy + interrupted official model download + inference. */
async function verifyPackagedQuality(app, page) {
  await page.locator('[data-paper-row-id]').first().dblclick();
  const channel = page.getByRole('combobox', { name: '划词翻译渠道', exact: true });
  if (!await channel.isVisible()) await page.getByRole('button', { name: '实时翻译', exact: true }).click();
  await channel.selectOption('offline-quality');
  const state = () => page.evaluate(() => window.paperquay.invoke('quality_translation_status'));
  const installButton = () => page.getByRole('button', { name: /^(下载并启用 Hy-MT2 Q4|检查并继续)/ });
  async function waitState(predicate, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = await state();
      if (predicate(current)) return current;
      if (!current.installing && current.error && current.errorCode !== 'DOWNLOAD_PAUSED') throw new Error(current.error);
      await page.waitForTimeout(250);
    }
    throw new Error(`Model state timed out: ${JSON.stringify(await state())}`);
  }
  async function setProxy(broken) {
    await app.evaluate(async ({ session }, { broken, partition }) => {
      const downloads = session.fromPartition(partition, { cache: false });
      await downloads.setProxy(broken ? { proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9' } : { mode: 'direct' });
      await downloads.closeAllConnections();
    }, { broken, partition: MODEL_DOWNLOAD_PARTITION });
  }
  try {
    await setProxy(true);
    await installButton().click();
    await page.getByText(/模型下载未完成（huggingface.co/).first().waitFor({ timeout: 30000 });
    const failed = await state();
    console.log('QUALITY_PROXY_FAILURE', JSON.stringify(failed));
    assert.equal(failed.ready, false); assert.equal(failed.errorPhase, 'download');
    assert.match(failed.errorCode, /PROXY|TUNNEL|CONNECTION_REFUSED/);
    console.log('PASS packaged model download follows Chromium session proxy and reports its connection failure.');
    await setProxy(false);
    await installButton().click();
    await page.getByRole('progressbar', { name: '模型下载进度', exact: true }).waitFor({ timeout: 90000 });
    await waitState(current => current.progress?.received >= 1048576, 90000);
    await page.getByRole('button', { name: '暂停下载（保留进度）', exact: true }).click();
    await waitState(current => !current.installing);
    const partial = await state();
    assert(partial.partialBytes > 0 && partial.partialBytes < partial.expectedBytes, 'Paused model prefix was not preserved.');
    console.log('PASS actual packaged UI progress and pause retained bytes:', partial.partialBytes);
    await installButton().click();
    const ready = await waitState(current => !current.installing && current.ready && !!current.backend);
    assert.equal(ready.bytes, 1133080448); assert.equal(ready.partialBytes, 0); assert(ready.backend);
    const translated = await page.evaluate(() => window.paperquay.invoke('selection_translate', { text: 'The sample size was 20.', source: 'English', target: 'Chinese', provider: 'offline-quality', requestId: 'packaged-real-quality' }));
    assert.match(translated.translation, /20/); assert.match(translated.translation, /[\u3400-\u9fff]/);
    console.log('PASS actual packaged resume, ASAR license/manifest registration and inference:', translated.translation);
    // Healthy-model repair must work while downloads are unavailable, proving no duplicate 1.13GB transfer.
    await setProxy(true);
    const repaired = await page.evaluate(() => window.paperquay.invoke('quality_translation_install', { force: true }));
    assert.equal(repaired.ready, true); assert.equal(repaired.bytes, ready.bytes); assert.equal(repaired.progress.message, '已复用完整模型并启用');
    console.log('PASS packaged repair reused verified weights with download network unavailable.');
  } catch (error) {
    console.log('QUALITY_FAILURE_STATE', JSON.stringify(await state().catch(() => null)));
    console.log('QUALITY_FAILURE_UI', (await page.locator('body').innerText()).slice(-5000));
    throw error;
  } finally { await setProxy(false); }
}
module.exports = { verifyPackagedQuality };
