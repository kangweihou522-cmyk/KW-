// Kept the upstream IPC name for compatibility; all PDF processing is local.
const fs = require('node:fs/promises');
const path = require('node:path');
const { cleanString, ensureFile, fileNameFromPath, hashFile } = require('./utils.cjs');
const { parseLocalPdf } = require('./localPdfParser.cjs');

async function addOfflineOcr(parsed, pdfPath) {
  const missing = parsed.pages.flatMap((blocks, pageIndex) => blocks.length ? [] : [pageIndex]);
  if (!missing.length) return parsed;
  let ocrPages;
  try {
    const { extractScannedPdf } = require('./offlineOcr.cjs');
    ocrPages = await extractScannedPdf({ pdfPath });
  } catch (error) {
    if (parsed.pages.every((blocks) => blocks.length === 0)) {
      throw new Error(`扫描 PDF 需要本地 OCR，文件未上传。${error.message}`);
    }
    return parsed;
  }
  const byPage = new Map((Array.isArray(ocrPages) ? ocrPages : []).map((page) => [page.pageIndex, page.text]));
  let filled = 0;
  for (const pageIndex of missing) {
    const text = typeof byPage.get(pageIndex) === 'string' ? byPage.get(pageIndex).trim() : '';
    if (!text) continue;
    parsed.pages[pageIndex] = [{ type: 'paragraph', content: text }];
    filled += 1;
  }
  const remaining = parsed.pages.flatMap((blocks, pageIndex) => blocks.length ? [] : [pageIndex + 1]);
  parsed.warnings = remaining.length
    ? [`第 ${remaining.join('、')} 页无可识别文字；报告未覆盖这些页面，不应视为完整证据分析。`]
    : [];
  parsed.engine = filled ? 'pdfjs-local-text-and-offline-ocr' : parsed.engine;
  parsed.markdown = parsed.pages.map((blocks, index) => {
    const text = blocks.map((block) => typeof block.content === 'string' ? block.content : '').join('\n\n');
    return `# Page ${index + 1}\n${text || '[本页无可识别文字；可能是扫描件、图表或空白页，未用于证据分析。]'}`;
  }).join('\n\n');
  if (parsed.warnings.length) parsed.markdown = `[解析范围提示] ${parsed.warnings.join(' ')}\n\n${parsed.markdown}`;
  if (parsed.pages.every((blocks) => blocks.length === 0)) throw new Error('本地 OCR 未识别到文字，请核查扫描质量与 OCR 语言包；未上传文件。');
  return parsed;
}

function createMineruCommands(context) {
  const { appPaths } = context;
  return {
    async run_mineru_cloud_parse({ options }) {
      const pdfPath = cleanString(options?.pdfPath);
      await ensureFile(pdfPath);
      const fileName = fileNameFromPath(pdfPath);
      const fingerprint = await hashFile(pdfPath);
      const extractDir = options.extractDir || path.join(appPaths.mineruCacheDir, `local-${fingerprint.slice(0, 20)}`);
      const contentJsonPath = path.join(extractDir, 'content_list_v2.json');
      const markdownPath = path.join(extractDir, 'full.md');
      let parsed;
      try {
        parsed = await parseLocalPdf(pdfPath);
      } catch (error) {
        if (error.code !== 'LOCAL_OCR_REQUIRED') throw error;
        parsed = { pages: Array.from({ length: error.pageCount || 1 }, () => []), warnings: [], markdown: '', engine: 'pdfjs-local-text', pageCount: error.pageCount || 1 };
      }
      parsed = await addOfflineOcr(parsed, pdfPath);
      const contentJsonText = JSON.stringify(parsed.pages, null, 2);
      const markdownText = parsed.markdown;
      await fs.mkdir(extractDir, { recursive: true });
      await fs.writeFile(contentJsonPath, contentJsonText, 'utf8');
      await fs.writeFile(markdownPath, markdownText, 'utf8');
      await fs.writeFile(path.join(extractDir, 'paperdesk-parse.json'), JSON.stringify({
        engine: parsed.engine, fingerprint, pageCount: parsed.pageCount, warnings: parsed.warnings,
      }, null, 2));
      return {
        batchId: `local-${fingerprint.slice(0, 20)}`,
        dataId: `local-${fingerprint}`,
        fileName,
        state: 'done',
        fullZipUrl: '',
        contentJsonText,
        middleJsonText: null,
        markdownText,
        assetRootDir: extractDir,
        contentJsonPath,
        middleJsonPath: null,
        markdownPath,
        zipEntries: [],
        engine: parsed.engine,
        warnings: parsed.warnings,
      };
    },
  };
}

module.exports = { createMineruCommands, addOfflineOcr };
