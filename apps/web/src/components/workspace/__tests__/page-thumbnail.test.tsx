import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PageThumbnail } from '../page-thumbnail';

const thumbnail = vi.fn<(documentId: string, pageIndex: number) => Promise<unknown>>();

vi.mock('@/workspace/services', () => ({
  useWorkspaceServices: () => ({ render: { thumbnail } }),
}));

/** jsdom nao desenha: um contexto de mentira basta para o caminho de sucesso terminar. */
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
}

describe('PageThumbnail', () => {
  beforeEach(() => {
    thumbnail.mockReset();
    stubCanvas();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra folha em branco com arquivo e pagina de origem quando a renderizacao falha', async () => {
    thumbnail.mockRejectedValue(new Error('pdf.js explodiu'));

    render(
      <PageThumbnail documentId="doc-1" pageIndex={4} rotate={0} fileName="contrato-2026.pdf" />,
    );

    const marcador = await screen.findByTestId('thumbnail-placeholder');
    await waitFor(() => expect(marcador).toHaveAttribute('data-status', 'failed'));

    // A referencia e o ponto: sem ela, uma pagina sem imagem no meio de varios PDFs vira um
    // buraco que o usuario nao consegue identificar.
    expect(marcador).toHaveTextContent('contrato-2026.pdf');
    // Numero da pagina NO ARQUIVO DE ORIGEM (base 1), nao a posicao na montagem.
    expect(marcador).toHaveTextContent('p. 5');
  });

  it('mostra a folha em branco enquanto a imagem nao chegou', () => {
    thumbnail.mockReturnValue(new Promise(() => undefined));

    render(<PageThumbnail documentId="doc-1" pageIndex={0} rotate={0} fileName="a.pdf" />);

    expect(screen.getByTestId('thumbnail-placeholder')).toHaveAttribute('data-status', 'pending');
  });

  it('troca a folha pela imagem quando a renderizacao funciona', async () => {
    thumbnail.mockResolvedValue({
      bitmap: {} as ImageBitmap,
      widthPx: 120,
      heightPx: 160,
      widthPt: 200,
      heightPt: 300,
    });

    render(<PageThumbnail documentId="doc-1" pageIndex={0} rotate={0} fileName="a.pdf" />);

    await waitFor(() =>
      expect(screen.queryByTestId('thumbnail-placeholder')).not.toBeInTheDocument(),
    );
  });
});
