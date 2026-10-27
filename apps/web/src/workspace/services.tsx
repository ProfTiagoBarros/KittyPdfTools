'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRenderWorkspace, type RenderWorkspace } from '@/workers/render-client';
import { createDocumentWorkspace, type DocumentWorkspace } from '@/workers/documents-client';
import type { GenerationAround } from '@/lib/generation';

export interface WorkspaceServices {
  /** Miniaturas e ofuscacao. Detem os documentos abertos no pdf.js. */
  readonly render: RenderWorkspace;
  /** Composicao e divisao. So usa pdf-lib. */
  readonly documents: DocumentWorkspace;
}

const ServicesContext = createContext<WorkspaceServices | null>(null);

/**
 * Os workers sao da SESSAO, nao da rota.
 *
 * Antes cada ferramenta montava o proprio provedor, e trocar de ferramenta destruia os workers
 * e criava outros. O store de documentos, que e de modulo, sobrevivia a troca — entao a grade
 * continuava listando paginas cujos bytes nao existiam mais em worker nenhum, e todas as
 * miniaturas quebravam de uma vez.
 *
 * Manter vivo tambem e o comportamento certo de produto: a tela inteira foi desenhada em volta
 * de UMA montagem com cinco ferramentas na lateral. Perder os arquivos ao trocar de ferramenta
 * seria contrario ao que a interface promete — e pedir confirmacao antes de perder apenas
 * tornaria a perda educada.
 *
 * O preco e que os workers vivem ate a aba fechar. E deliberado: eles sao o espaco de trabalho.
 */
let sharedServices: WorkspaceServices | null = null;

function servicesForSession(): WorkspaceServices {
  sharedServices ??= {
    render: createRenderWorkspace(),
    documents: createDocumentWorkspace(),
  };
  return sharedServices;
}

export function WorkspaceServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<WorkspaceServices | null>(null);

  useEffect(() => {
    /*
     * Workers so podem ser criados apos a montagem: com `output: 'export'` as paginas sao
     * pre-renderizadas no build, onde `Worker` nao existe, e criar no inicializador de estado
     * seria efeito colateral durante o render, duplicado pelo StrictMode. O custo e um render
     * extra no inicio da sessao.
     *
     * Sem limpeza no desmonte, de proposito: quem encerra os workers encerraria tambem os
     * documentos que a proxima ferramenta vai usar.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServices(servicesForSession());
  }, []);

  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** Devolve `null` ate os workers existirem — a UI mostra o estado de carregamento. */
export function useWorkspaceServices(): WorkspaceServices | null {
  return useContext(ServicesContext);
}

/**
 * Solta os documentos abertos na renderizacao durante uma operacao pesada.
 *
 * Os documentos abertos no pdf.js ficam parados enquanto o pdf-lib monta o resultado, e os
 * dois workers dividem o processo da tela. Solta-los deixa a operacao com a memoria inteira.
 * Depois nao ha o que restaurar: cada documento volta do arquivo quando a grade pedir por ele,
 * e as miniaturas ja desenhadas continuam no cache. Pedidos durante a operacao esperam.
 */
export function usePageMemoryRelease(): GenerationAround | undefined {
  const services = useWorkspaceServices();

  return useMemo(() => {
    if (services === null) return undefined;

    return {
      before: () => services.render.release(),
      // Nada a reabrir: cada documento volta do arquivo quando a grade pedir por ele.
      after: () => {
        services.render.resume();
        return Promise.resolve();
      },
    };
  }, [services]);
}
