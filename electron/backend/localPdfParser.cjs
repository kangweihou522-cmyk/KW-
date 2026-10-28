// PaperDesk modification: local text extraction only. Never uploads a PDF.
const fsp = require('node:fs/promises');
const path = require('node:path');

let pdfJsPromise;

function localPdfJs() {
  // Keep the external import: PDF.js resolves its own worker beside this file
  // inside pdfjs-dist, both in Node and in Electron's packaged app.
  pdfJsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfJsPromise;
}

function normalizedText(text) {
  return String(text ?? '').replace(/[\u00a0\u2000-\u200d\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
}

function itemBounds(item, viewport) {
  const transform = item.transform;
  if (!Array.isArray(transform) || transform.length !== 6) return null;
  const x = transform[4];
  const y = transform[5];
  const width = Math.max(0.5, Math.abs(Number(item.width) || 0));
  const height = Math.max(1, Math.abs(Number(item.height) || Math.hypot(transform[2], transform[3]) || 10));
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([x, y - height * 0.2, x + width, y + height * 0.8]);
  const left = Math.max(0, Math.min(x1, x2));
  const top = Math.max(0, Math.min(y1, y2));
  const right = Math.min(viewport.width, Math.max(x1, x2));
  const bottom = Math.min(viewport.height, Math.max(y1, y2));
  return right > left && bottom > top ? [left, top, right, bottom] : null;
}

function mergeBounds(left, right) {
  if (!left) return right;
  if (!right) return left;
  return [Math.min(left[0], right[0]), Math.min(left[1], right[1]), Math.max(left[2], right[2]), Math.max(left[3], right[3])];
}

function pageTextBlocks(content, viewport) {
  const blocks = [];
  let line = null;
  const flush = () => {
    if (line && normalizedText(line.text)) {
      blocks.push({
        type: 'paragraph',
        content: normalizedText(line.text),
        ...(line.bbox ? { bbox: line.bbox } : {}),
        bboxCoordinateSystem: 'pdf',
        bboxPageSize: [viewport.width, viewport.height],
      });
    }
    line = null;
  };

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const text = String(item.str ?? '');
    const bbox = itemBounds(item, viewport);
    // Preserve PDF.js reading order; do not sort columns into one another.
    // Merge fragments on a common text line without inventing paragraph order.
    const newLine = line && bbox && line.bbox && (
      Math.abs(bbox[1] - line.bbox[1]) > Math.max(3, (bbox[3] - bbox[1]) * 0.6) ||
      bbox[0] < line.bbox[0] - 4
    );
    if (newLine) flush();
    if (!line) line = { text: '', bbox: null };
    const gap = bbox && line.bbox ? bbox[0] - line.bbox[2] : 0;
    const separator = line.text && !/\s$/.test(line.text) && !/^\s/.test(text) && gap > 0.75 ? ' ' : '';
    line.text += separator + text;
    line.bbox = mergeBounds(line.bbox, bbox);
    if (item.hasEOL) flush();
  }
  flush();
  return blocks;
}

async function parseLocalPdfBytes(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error('本地 PDF 文件为空或格式无效。');
  }
  const { getDocument } = await localPdfJs();
  const assetRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    cMapUrl: path.join(assetRoot, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(assetRoot, 'standard_fonts') + path.sep,
  });
  let document;
  try {
    document = await task.promise;
    const pages = [];
    const markdownPages = [];
    const warnings = [];
    let textPages = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const blocks = pageTextBlocks(await page.getTextContent(), page.getViewport({ scale: 1 }));
        pages.push(blocks);
        if (blocks.length === 0) {
          const message = `第 ${pageNumber} 页无可提取文本，可能是扫描页、图片页或空白页；本地 OCR 尚未配置，不能视为已阅读全文。`;
          warnings.push(message);
          markdownPages.push(`# Page ${pageNumber}\n\n[${message}]`);
        } else {
          textPages += 1;
          markdownPages.push(`# Page ${pageNumber}\n\n${blocks.map((block) => block.content).join('\n\n')}`);
        }
      } finally {
        page.cleanup();
      }
    }
    if (textPages === 0) {
      const error = new Error('此 PDF 没有可提取的文本。请先用本地 OCR 生成可搜索 PDF 后重试；PaperDesk 不会把文件上传至云端。');
      error.code = 'LOCAL_OCR_REQUIRED';
      error.pageCount = document.numPages;
      throw error;
    }
    return {
      engine: 'pdfjs-local-text',
      pages,
      markdown: markdownPages.join('\n\n'),
      pageCount: document.numPages,
      warnings,
      filename: options.filename || '',
    };
  } catch (error) {
    if (error?.name === 'PasswordException') {
      const protectedError = new Error('此 PDF 需要密码。请先在本机解锁并保存副本，再进行本地解析。');
      protectedError.code = 'LOCAL_PDF_PASSWORD_REQUIRED';
      throw protectedError;
    }
    throw error;
  } finally {
    if (document) await document.destroy();
    else await task.destroy();
  }
}

async function parseLocalPdf(pdfPath) {
  if (typeof pdfPath !== 'string' || !pdfPath.trim() || path.extname(pdfPath).toLowerCase() !== '.pdf') {
    throw new Error('请选择本机 PDF 文件。');
  }
  const stat = await fsp.stat(pdfPath);
  if (!stat.isFile()) throw new Error('所选 PDF 路径不是文件。');
  return parseLocalPdfBytes(await fsp.readFile(pdfPath), { filename: path.basename(pdfPath) });
}

module.exports = { parseLocalPdf, parseLocalPdfBytes };
