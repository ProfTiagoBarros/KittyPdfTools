'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useWorkspaceServices } from '@/workspace/services';
import { drawRotated } from '@/lib/draw-page';

interface PageThumbnailProps {
  readonly documentId: string;
  /** Indice da pagina NO ARQUIVO DE ORIGEM, base 0. */
  readonly pageIndex: number;
  /** Graus horarios acumulados pelo usuario. */
  readonly rotate: number;
  /** Nome do arquivo de origem, mostrado quando a imagem nao existe. */
  readonly fileName: string;
}

/** Distancia, em pixels, para comecar a renderizar antes de a pagina entrar na tela. */
const PRELOAD_MARGIN = '400px';

type Status = 'pending' | 'ready' | 'failed';

/**
 * Miniatura de uma pagina.
 *
 * A rotacao e aplicada ao DESENHAR no canvas, e nao por transformacao CSS: girando 90 graus,
 * largura e altura trocam de lugar, e uma transformacao visual deixaria a imagem estourando
 * a celula da grade.
 *
 * **Renderiza sob demanda.** Um documento de centenas de paginas disparava um pedido por
 * pagina no momento em que a grade montava; num celular isso e memoria e trabalho suficientes
 * para a renderizacao comecar a falhar. Agora o pedido so sai quando a pagina se aproxima da
 * tela.
 *
 * **Nunca fica um buraco no lugar da pagina.** Enquanto a imagem nao existe — e tambem quando
 * ela falha de vez — o espaco mostra uma folha em branco com o arquivo de origem e o numero da
 * pagina naquele arquivo. Sem essa referencia, uma miniatura ausente no meio de uma montagem
 * com varios PDFs deixa o usuario sem saber que pagina e aquela.
 */
export function PageThumbnail({ documentId, pageIndex, rotate, fileName }: PageThumbnailProps) {
  const { t } = useTranslation();
  const services = useWorkspaceServices();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * Sem IntersectionObserver, ja nasce liberado: degradar para "nenhuma miniatura" seria pior
   * do que o custo que o observador evita.
   *
   * A decisao vem do inicializador do `useState`, e nao de um `setState` dentro do efeito:
   * mudar estado no corpo do efeito provoca render em cascata. Nada no HTML depende deste
   * valor — ele so decide QUANDO pedir a imagem —, entao ler a capacidade no primeiro render
   * e seguro tambem sob geracao estatica.
   */
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [status, setStatus] = useState<Status>('pending');

  useEffect(() => {
    if (visible) return undefined;

    const container = containerRef.current;
    if (container === null) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (services === null || !visible) return undefined;

    let cancelled = false;

    void services.render
      .thumbnail(documentId, pageIndex)
      .then((thumbnail) => {
        const canvas = canvasRef.current;
        if (cancelled || canvas === null) return;

        // Mesmo desenho da visualizacao ampliada: se os dois divergirem, a pagina que o
        // usuario inspeciona deixa de ser a que ele vai receber.
        drawRotated(canvas, thumbnail, rotate);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        // A causa vai para o console de proposito. Este `catch` ja escondeu o motivo real de
        // miniaturas faltando — o pdf.js sem os assets de fonte e CMap — e a tela so mostrava
        // um retangulo cinza. A folha em branco continua sendo a resposta certa para o
        // usuario; quem depura precisa do porque.
        console.error('Falha ao renderizar miniatura', { documentId, pageIndex, fileName }, cause);
        if (!cancelled) setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [services, visible, documentId, pageIndex, rotate, fileName]);

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center">
      {/*
        O canvas fica montado mesmo escondido: a referencia precisa existir quando o desenho
        chega, e remove-lo do DOM enquanto carrega faria o resultado nao ter onde ser pintado.
      */}
      <canvas
        ref={canvasRef}
        className={status === 'ready' ? 'max-h-full max-w-full bg-white shadow-sm' : 'hidden'}
        aria-hidden="true"
      />

      {status !== 'ready' && (
        <div
          data-testid="thumbnail-placeholder"
          data-status={status}
          title={t('workspace.thumbnailUnavailable')}
          className="flex h-full w-[70%] flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-neutral-300 bg-white p-1 text-center dark:border-neutral-600 dark:bg-neutral-100"
        >
          <span
            className="w-full truncate text-[10px] leading-tight text-neutral-600"
            title={fileName}
          >
            {fileName}
          </span>
          <span className="text-[10px] font-medium text-neutral-500 tabular-nums">
            {t('workspace.sourcePage', { number: pageIndex + 1 })}
          </span>
        </div>
      )}
    </div>
  );
}
