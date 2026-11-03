import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfCanvasPixelBudget } from '../src/features/pdf/pdfCanvasQuality.ts';
test('high DPI has enough backing pixels for a zoomed paper and bounded memory on small machines', () => {
  const budget = pdfCanvasPixelBudget(1920, 1080, 2, 8);
  assert(budget >= 1920 * 1080 * 4 * 2);
  assert(pdfCanvasPixelBudget(7680, 4320, 3, 8) <= 48 * 1024 * 1024);
  assert.equal(pdfCanvasPixelBudget(7680, 4320, 3, 2), 16 * 1024 * 1024);
});
