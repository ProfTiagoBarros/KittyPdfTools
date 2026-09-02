'use client';

import { Download } from 'lucide-react';
import { toPageRefs } from '@/workspace/model';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import { WorkspaceShell } from './workspace-shell';
import { useGeneration } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { getTool } from '@/tools/registry';

/** Acao principal de Unir: montar a composicao e entregar o PDF final. */
function ExportAction() {
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);
  const generation = useGeneration();

  return (
    <GenerationAction
      generation={generation}
      icon={Download}
      labelKey="action.export"
      runningLabelKey="action.exporting"
      disabled={services === null || items.length === 0}
      testId="export"
      onRun={() =>
        generation.run({
          suggestedName: 'pdfkitty.pdf',
          // Compor nao sabe estimar o quanto falta: a interface mostra atividade, sem
          // porcentagem, em vez de uma barra fingindo saber.
          produce: async () => {
            if (services === null) throw new Error('workers ainda nao estao prontos');
            return services.documents.compose(toPageRefs(items));
          },
        })
      }
    />
  );
}

export function OrganizeTool() {
  return (
    <WorkspaceServicesProvider>
      <WorkspaceShell titleKey={getTool('unir').nameKey} action={<ExportAction />} />
    </WorkspaceServicesProvider>
  );
}
