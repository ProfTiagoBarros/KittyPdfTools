import { loadWithPdfjs } from './pdfjs';
import { findTextRectIn } from '../verification/index';
import type { Rect } from '../geometry';

export { createTextPdf, PAGE_WIDTH, PAGE_HEIGHT } from '../fixtures';
export type { FixtureLine } from '../fixtures';

export async function findTextRect(
  pdf: Uint8Array,
  needle: string,
  pageIndex = 0,
): Promise<Rect | undefined> {
  const { doc, dispose } = await loadWithPdfjs(pdf);
  const rect = await findTextRectIn(doc, needle, pageIndex);
  await dispose();
  return rect;
}
