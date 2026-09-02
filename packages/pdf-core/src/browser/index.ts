export { configurePdfjs } from './pdfjs-setup';
export { openForRendering } from './renderer';
export type { DocumentRenderer, PageThumbnail } from './renderer';
export {
  extractAllText,
  findTextRect,
  existsInFileBytes,
  hasIncrementalHistory,
  samplePixels,
} from './verification';
export type { Pixel, SamplePoint } from './verification';
