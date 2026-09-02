'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Rect } from 'pdf-core';
import { useTranslation } from '@/i18n';
import { useWorkspaceServices } from '@/workspace/services';

/** Resolucao do render usado para marcar. Precisa ser grande o bastante para mirar. */
const VIEWER_EDGE = 1100;

interface PageViewerProps {
  readonly documentId: string;
  readonly pageIndex: number;
  /** Regioes ja marcadas, em espaco de usuario do PDF. */
  readonly marks: readonly Rect[];
  readonly onAddMark: (rect: Rect) => void;
}

interface Page {
  readonly bitmap: ImageBitmap;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

interface DragBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Pagina em tamanho de trabalho, com marcacao de regioes por arrasto.
 *
 * O desenho acontece em pixels do canvas, mas a regiao e guardada em espaco de usuario do
 * PDF — pontos, origem embaixo. Converter na saida, e nao depois, evita que a marcacao
 * dependa do zoom ou do tamanho da janela no momento em que foi feita.
 */
export function PageViewer({ documentId, pageIndex, marks, onAddMark }: PageViewerProps) {
  const { t } = useTranslation();
  const services = useWorkspaceServices();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [drag, setDrag] = useState<DragBox | null>(null);

  useEffect(() => {
    if (services === null) return;
    let cancelled = false;

    void services.render
      .thumbnail(documentId, pageIndex, VIEWER_EDGE)
      .then((image) => {
        if (!cancelled) setPage(image);
      })
      .catch(() => {
        if (!cancelled) setPage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [services, documentId, pageIndex]);

  // Redesenha a pagina e as marcas sempre que qualquer um dos dois muda.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || page === null) return;

    canvas.width = page.widthPx;
    canvas.height = page.heightPx;

    const context = canvas.getContext('2d');
    if (context === null) return;

    context.drawImage(page.bitmap, 0, 0);

    const toPixels = (rect: Rect) => ({
      x: (rect.x / page.widthPt) * page.widthPx,
      // O eixo Y do PDF cresce para cima; o do canvas, para baixo.
      y: ((page.heightPt - rect.y - rect.height) / page.heightPt) * page.heightPx,
      width: (rect.width / page.widthPt) * page.widthPx,
      height: (rect.height / page.heightPt) * page.heightPx,
    });

    context.fillStyle = 'rgba(0, 0, 0, 0.85)';
    for (const mark of marks) {
      const box = toPixels(mark);
      context.fillRect(box.x, box.y, box.width, box.height);
    }

    if (drag !== null) {
      context.strokeStyle = '#dc2626';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeRect(
        Math.min(drag.x0, drag.x1),
        Math.min(drag.y0, drag.y1),
        Math.abs(drag.x1 - drag.x0),
        Math.abs(drag.y1 - drag.y0),
      );
      context.setLineDash([]);
    }
  }, [page, marks, drag]);

  /** Converte a posicao do ponteiro para pixels do canvas, considerando a escala do CSS. */
  const toCanvasPoint = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }, []);

  function handleDown(event: PointerEvent<HTMLCanvasElement>): void {
    if (page === null) return;
    const point = toCanvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
  }

  function handleMove(event: PointerEvent<HTMLCanvasElement>): void {
    if (drag === null) return;
    const point = toCanvasPoint(event);
    setDrag({ ...drag, x1: point.x, y1: point.y });
  }

  function handleUp(): void {
    if (drag === null || page === null) return;
    setDrag(null);

    const widthPx = Math.abs(drag.x1 - drag.x0);
    const heightPx = Math.abs(drag.y1 - drag.y0);
    // Um clique sem arrasto nao e uma regiao; marcar um ponto apagaria nada e confundiria.
    if (widthPx < 4 || heightPx < 4) return;

    const leftPx = Math.min(drag.x0, drag.x1);
    const bottomPx = Math.max(drag.y0, drag.y1);

    onAddMark({
      x: (leftPx / page.widthPx) * page.widthPt,
      y: page.heightPt - (bottomPx / page.heightPx) * page.heightPt,
      width: (widthPx / page.widthPx) * page.widthPt,
      height: (heightPx / page.heightPx) * page.heightPt,
    });
  }

  if (page === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-neutral-500">
        {t('workspace.loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 justify-center overflow-auto p-4">
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        data-testid="page-viewer"
        data-page-index={pageIndex}
        data-marks={marks.length}
        className="h-fit max-w-full cursor-crosshair touch-none bg-white shadow"
        aria-label={t('redact.viewerLabel', { number: pageIndex + 1 })}
      />
    </div>
  );
}
