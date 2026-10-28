const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function extractScannedPdf({ pdfPath, language = 'eng', pythonPath, timeoutMs = 600000 }) {
  const python = pythonPath || process.env.PAPERDESK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'ocr', 'ocr_pdf.py');
  const script = packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'scripts', 'ocr', 'ocr_pdf.py');
  return new Promise((resolve, reject) => {
    execFile(python, [script, '--pdf', path.resolve(pdfPath), '--language', language], {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        const reason = error.killed ? 'OCR 超时；请拆分较长的扫描文件后重试。' :
          String(stderr || error.message).trim().slice(-1800);
        reject(new Error(`本地 OCR 未完成：${reason}\n请按 docs/LOCAL_OCR.md 安装 Python、PyMuPDF 和 Tesseract；文件不会上传云端。`));
        return;
      }
      try {
        const pages = JSON.parse(stdout);
        if (!Array.isArray(pages) || !pages.some((page) => typeof page.text === 'string' && page.text.trim())) {
          throw new Error('未识别到可用文字，请检查扫描清晰度与 OCR 语言包。');
        }
        if (pages.some((page, i) => page.pageIndex !== i || typeof page.text !== 'string')) {
          throw new Error('OCR 输出缺少连续页码或文本。');
        }
        resolve(pages);
      } catch (parseError) { reject(new Error(`本地 OCR 结果无效：${parseError.message}`)); }
    });
  });
}

module.exports = { extractScannedPdf };
