'use client';

import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices } from '@/workspace/services';
import { useTranslation, type MessageKey } from '@/i18n';
import { ToolSidebar } from './tool-sidebar';
import { PropertiesPanel } from './properties-panel';
import { BottomBar } from './bottom-bar';
import { Dropzone } from './dropzone';
import { PageGrid } from './page-grid';
import { SearchField } from './search-field';
import { canRenderPages } from '@/lib/capabilities';

let documentCounter = 0;

interface WorkspaceShellProps {
  readonly titleKey: MessageKey;
  /** Opcoes da ferramenta ativa, no painel direito. */
  readonly panel?: ReactNode;
  /** Acao principal da ferramenta, na barra inferior. */
  readonly action: ReactNode;
  /**
   * Substitui a grade de miniaturas na area central.
   *
   * Ofuscar precisa da pagina grande para o usuario mirar; uma miniatura de 120 px nao serve
   * para marcar a regiao certa num documento juridico.
   */
  readonly main?: ReactNode;
}

/**
 * Casca comum a todas as ferramentas: sidebar, area de arquivos, grade de miniaturas,
 * painel de propriedades e barra inferior.
 *
 * Carregar e remover documentos e responsabilidade da casca porque vale para toda ferramenta;
 * o que cada uma FAZ com as paginas entra pelos slots `panel` e `action`.
 */
export function WorkspaceShell({ titleKey, panel, action, main }: WorkspaceShellProps) {
  const { t } = useTranslation();
  const services = useWorkspaceServices();

  const documents = useWorkspaceStore((state) => state.documents);
  const items = useWorkspaceStore((state) => state.items);
  const addDocument = useWorkspaceStore((state) => state.addDocument);
  const removeDocument = useWorkspaceStore((state) => state.removeDocument);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Capacidade do motor: valor que so existe no cliente.
   *
   * `useSyncExternalStore` e a forma correta — ler no render seria errado sob geracao
   * estatica, e ler num efeito com `setState` provocaria render em cascata. O snapshot de
   * servidor presume suporte, para o aviso nao piscar na tela de quem tem.
   */
  const canRender = useSyncExternalStore(
    () => () => undefined,
    canRenderPages,
    () => true,
  );

  const handleFiles = useCallback(
    async (files: readonly File[]) => {
      if (services === null || files.length === 0) return;

      setBusy(true);
      setError(null);

      for (const file of files) {
        const documentId = `doc-${(documentCounter += 1)}`;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());

          // Cada worker recebe a sua copia: a transfer list DESTACA o buffer enviado, e os
          // dois precisam dos bytes — o de renderizacao para as miniaturas, o de documentos
          // para compor. E o custo de manter os dois separados.
          const forRender = bytes.slice().buffer;
          const forDocuments = bytes.slice().buffer;

          const pageCount = await services.render.open(documentId, forRender);
          await services.documents.load(documentId, forDocuments);

          addDocument({ id: documentId, name: file.name, pageCount });
        } catch (cause) {
          // A mensagem na tela e deliberadamente generica — o usuario nao precisa saber de
          // pdf.js. A causa vai ao console porque, sem ela, "arquivo corrompido" e tudo o que
          // se sabe quando o defeito e nosso.
          console.error('Falha ao carregar documento', { file: file.name }, cause);
          setError(t('error.loadFailed', { file: file.name }));
        }
      }

      setBusy(false);
    },
    [services, addDocument, t],
  );

  const handleRemoveDocument = useCallback(
    (documentId: string) => {
      removeDocument(documentId);
      void services?.render.close(documentId);
      void services?.documents.unload(documentId);
    },
    [services, removeDocument],
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        Cabecalho para leitores de tela. A ferramenta ativa ja aparece destacada na sidebar,
        entao um titulo visivel seria redundante — mas uma pagina sem h1 deixa quem navega
        por cabecalhos sem ponto de entrada.
      */}
      <h1 className="sr-only">{t(titleKey)}</h1>

      <div className="flex flex-1 flex-col md:flex-row">
        <ToolSidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-col gap-3 p-4">
            <Dropzone
              onFiles={(files) => void handleFiles(files)}
              busy={busy || services === null}
            />
            {/* So aparece com documento carregado: buscar em nada nao e uma acao. */}
            {documents.length > 0 && <SearchField />}
          </div>

          {!canRender && (
            <div
              role="status"
              data-testid="unsupported-engine"
              className="mx-4 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <strong>{t('unsupported.title')}</strong>
              <span>{t('unsupported.detail')}</span>
              <span>{t('unsupported.workaround')}</span>
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              className="mx-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            {main ?? (
              <div className="flex-1 overflow-y-auto">
                <PageGrid />
              </div>
            )}
          </div>
        </main>

        <PropertiesPanel onRemoveDocument={handleRemoveDocument}>{panel}</PropertiesPanel>
      </div>

      <BottomBar>{action}</BottomBar>

      {/* Estado somente para os testes observarem sem depender de texto traduzido. */}
      <span
        className="sr-only"
        data-testid="workspace-state"
        data-documents={documents.length}
        data-pages={items.length}
        data-ready={services !== null}
      />
    </div>
  );
}
