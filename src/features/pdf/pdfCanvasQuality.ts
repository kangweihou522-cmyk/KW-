/** Backing pixels, independent of CSS page size. PDF.js still uses native DPR
 * and releases pages outside its rendering buffer; bound large zoom surfaces. */
export function pdfCanvasPixelBudget(width: number, height: number, dpr = 1, memoryGb = 8): number {
  const limit = (memoryGb <= 2 ? 16 : memoryGb <= 4 ? 24 : 48) * 1024 * 1024;
  const screenPixels = Math.max(1, width) * Math.max(1, height) * Math.max(1, dpr) ** 2;
  return Math.round(Math.min(limit, Math.max(16 * 1024 * 1024, screenPixels * 3)));
}
