'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { drawRotated } from '@/lib/draw-page';
import { useWorkspaceServices } from '@/workspace/services';
import { useWorkspaceStore } from '@/workspace/store';

interface PagePreviewProps {
  /** Chave do item por onde a visualizacao abre. */
  readonly startKey: string;
  readonly onClose: () => void;
}

/**
 * Resolucao da visualizacao rapida.
 *
 * Escolhida para LER, nao para imprimir: 1400 px na maior aresta poe um nome e um numero de
 * matricula confortavelmente legiveis numa pagina A4, e custa uma fracao do tempo de uma
 * renderizacao de qualidade. O worker guarda por tamanho, entao reabrir a mesma pagina nao
 * paga de novo.
 */
const PREVIEW_EDGE = 1400;

type Status = 'loading' | 'ready' | 'failed';

/**
 * Visualizacao rapida de uma pagina, com as acoes de ordenacao a mao.
 *
 * Nasceu de um relato de uso real: ordenando um documento de muitas paginas, a miniatura da
 * grade nao respondia "que pagina e esta?" — e a saida era gerar o PDF, conferir e voltar
 * para corrigir. O ciclo inteiro por causa de um nome ilegivel.
 *
 * Por isso a lupa nao e so um visor. Ela navega entre as paginas e traz mover e girar: quem
 * identifica a pagina errada ja a coloca no lugar, sem fechar, procurar o cartao na grade e
 * recomecar.
 */
export function PagePreview({ startKey, onClose }: PagePreviewProps) {
  const { t } = useTranslation();
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);
  const documents = useWorkspaceStore((state) => state.documents);
  const rotate = useWorkspaceStore((state) => state.rotate);
  const moveItem = useWorkspaceStore((state) => state.moveItem);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentKey, setCurrentKey] = useState(startKey);
  const [zoomed, setZoomed] = useState(false);
  /*
   * Qual pagina esta DESENHADA no canvas, e nao um booleano de "carregando".
   *
   * O estado sai daqui por derivacao, e nao de um `setState` no corpo do efeito. Isso resolve
   * de uma vez o problema que um sinalizador solto criaria: ao virar a pagina, o desenho
   * anterior continuaria na tela marcado como pronto ate a nova chegar — e mostrar a pagina
   * errada e o pior defeito possivel numa ferramenta feita para responder "que pagina e esta?".
   */
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const index = items.findIndex((item) => item.key === currentKey);
  const item = index === -1 ? undefined : items[index];

  /** A rotacao entra na identidade: girar exige redesenhar a mesma pagina. */
  const drawId = item === undefined ? '' : `${item.key}:${item.rotate}`;
  const status: Status =
    failedKey === drawId ? 'failed' : drawnKey === drawId ? 'ready' : 'loading';

  const go = useCallback(
    (delta: number) => {
      const alvo = items[index + delta];
      if (alvo === undefined) return;
      setCurrentKey(alvo.key);
      // Cada pagina comeca ajustada: manter a ampliacao ao virar deixaria a proxima aberta
      // num pedaco arbitrario, e o usuario esta procurando o cabecalho.
      setZoomed(false);
    },
    [items, index],
  );

  /*
   * A pagina pode sumir por baixo da visualizacao — desfazer, ou remover o arquivo de
   * origem. Fechar e a unica resposta honesta: continuar exibindo o ultimo desenho mostraria
   * uma pagina que nao esta mais no documento.
   */
  useEffect(() => {
    if (item === undefined) onClose();
  }, [item, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  useEffect(() => {
    if (services === null || item === undefined) return undefined;

    let cancelled = false;

    void services.render
      .thumbnail(item.source, item.pageIndex, PREVIEW_EDGE)
      .then((page) => {
        const canvas = canvasRef.current;
        if (cancelled || canvas === null) return;

        drawRotated(canvas, page, item.rotate);
        setDrawnKey(drawId);
      })
      .catch((cause: unknown) => {
        // A causa vai ao console: a tela mostra "nao foi possivel", que nao ajuda quem depura.
        console.error('Falha ao renderizar a visualizacao', { key: item.key }, cause);
        if (!cancelled) setFailedKey(drawId);
      });

    return () => {
      cancelled = true;
    };
  }, [services, item, drawId]);

  if (item === undefined) return null;

  const fileName = documents.find((document) => document.id === item.source)?.name ?? item.source;
  const origem = `${fileName} · ${t('workspace.sourcePage', { number: item.pageIndex + 1 })}`;

  // Portal para o body: a barra inferior usa `backdrop-blur`, e um filtro de fundo cria bloco
  // de contencao — um `fixed` dentro dela se posicionaria por ela, saindo da tela.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      data-testid="page-preview"
      data-page-key={item.key}
    >
      <header className="flex items-center justify-between gap-2 p-3 text-white">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular-nums" data-testid="preview-position">
            {t('preview.position', { position: index + 1, total: items.length })}
          </p>
          {/* De onde a pagina veio: e o que identifica uma pagina numa montagem de varios PDFs. */}
          <p className="truncate text-xs text-neutral-300" title={origem}>
            {origem}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t('preview.close')}
          title={t('preview.close')}
          data-testid="preview-close"
          className="text-white"
        >
          <X />
        </Button>
      </header>

      <div
        className={cn(
          'flex flex-1 justify-center p-2',
          // Ajustado centraliza; ampliado rola, e a rolagem comeca no topo, onde costuma
          // estar o cabecalho que identifica o documento.
          zoomed ? 'items-start overflow-auto' : 'items-center overflow-hidden',
        )}
        data-testid="preview-stage"
        data-zoomed={zoomed}
      >
        <canvas
          ref={canvasRef}
          data-testid="preview-canvas"
          className={cn(
            'bg-white shadow-lg',
            status !== 'ready' && 'hidden',
            zoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain',
          )}
          aria-label={t('preview.pageLabel', { number: index + 1, file: fileName })}
        />

        {status !== 'ready' && (
          <p className="text-sm text-neutral-300" data-testid="preview-status">
            {t(status === 'loading' ? 'workspace.loading' : 'preview.failed')}
          </p>
        )}
      </div>

      {/*
        Acoes na barra inferior, ao alcance do polegar no celular. Navegar nas pontas e as
        acoes no meio: a ordem de leitura acompanha a ordem de uso — olho a pagina, corrijo
        se preciso, sigo para a proxima.
      */}
      <footer className="flex items-center justify-between gap-1 p-3">
        <Button
          size="icon"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label={t('preview.previous')}
          title={t('preview.previous')}
          data-testid="preview-previous"
        >
          <ChevronLeft />
        </Button>

        <div className="flex flex-wrap justify-center gap-1">
          <Button
            size="icon"
            onClick={() => setZoomed((value) => !value)}
            aria-label={t(zoomed ? 'preview.fit' : 'preview.zoom')}
            title={t(zoomed ? 'preview.fit' : 'preview.zoom')}
            data-testid="preview-zoom"
            aria-pressed={zoomed}
          >
            {zoomed ? <ZoomOut /> : <ZoomIn />}
          </Button>
          <Button
            size="icon"
            onClick={() => rotate([item.key], -90)}
            aria-label={t('action.rotateLeft')}
            title={t('action.rotateLeft')}
            data-testid="preview-rotate-left"
          >
            <RotateCcw />
          </Button>
          <Button
            size="icon"
            onClick={() => rotate([item.key], 90)}
            aria-label={t('action.rotateRight')}
            title={t('action.rotateRight')}
            data-testid="preview-rotate-right"
          >
            <RotateCw />
          </Button>
          <Button
            size="sm"
            onClick={() => moveItem(index, index - 1)}
            disabled={index === 0}
            aria-label={t('action.moveBack')}
            title={t('action.moveBack')}
            data-testid="preview-move-back"
          >
            <ChevronLeft />
            {t('preview.move')}
          </Button>
          <Button
            size="sm"
            onClick={() => moveItem(index, index + 1)}
            disabled={index === items.length - 1}
            aria-label={t('action.moveForward')}
            title={t('action.moveForward')}
            data-testid="preview-move-forward"
          >
            {t('preview.move')}
            <ChevronRight />
          </Button>
        </div>

        <Button
          size="icon"
          onClick={() => go(1)}
          disabled={index === items.length - 1}
          aria-label={t('preview.next')}
          title={t('preview.next')}
          data-testid="preview-next"
        >
          <ChevronRight />
        </Button>
      </footer>
    </div>,
    document.body,
  );
}
