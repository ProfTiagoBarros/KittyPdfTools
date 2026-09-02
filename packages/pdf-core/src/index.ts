export { PdfCoreError, coreError, isPdfCoreError } from './errors';
export type { PdfCoreErrorCode, PdfCoreErrorParams, ErrorParamsByCode } from './errors';
export type { Rect } from './geometry';
export { normalizeRect, padRect } from './geometry';
export type {
  RedactionArea,
  RasterPage,
  RasterizeRequest,
  PageRasterizer,
} from './redaction/types';
export { paintBlackout } from './redaction/blackout';
export type { FillSurface, ViewportLike } from './redaction/blackout';
export { redactByRasterizing, type RedactOptions } from './redaction/rasterize-redaction';
export { createTextPdf, PAGE_WIDTH, PAGE_HEIGHT } from './fixtures';
export type { FixtureLine } from './fixtures';
export * from './verification/index';
export * from './composition/index';
export * from './split/index';
export * from './ocr/index';
