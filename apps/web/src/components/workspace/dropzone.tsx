'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

interface DropzoneProps {
  readonly onFiles: (files: readonly File[]) => void;
  readonly busy: boolean;
  /** Falso onde a ferramenta trabalha com um arquivo por vez. */
  readonly multiple?: boolean;
}

export function Dropzone({ onFiles, busy, multiple = true }: DropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * Aceita por tipo OU por extensao.
   *
   * Exigir `type === 'application/pdf'` descarta em SILENCIO arquivos que o seletor do Android
   * entrega com tipo vazio ou generico — o que acontece justamente com o que o proprio produto
   * gravou. O usuario escolhe o arquivo e nada acontece, sem explicacao.
   *
   * O que nao for PDF de verdade falha depois, ao ser lido, com mensagem traduzida — melhor do
   * que sumir sem aviso.
   */
  function pdfsFrom(list: FileList | null): File[] {
    return [...(list ?? [])].filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    onFiles(pdfsFrom(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        dragging
          ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
          : 'border-neutral-300 dark:border-neutral-700',
      )}
      data-testid="dropzone"
    >
      <Upload className="size-6 text-neutral-400" aria-hidden="true" />
      <p className="font-medium">
        {t(multiple ? 'workspace.dropzone.title' : 'workspace.dropzone.title.single')}
      </p>
      {/* A promessa de privacidade aparece no momento em que o arquivo entra, nao no rodape. */}
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        {t('workspace.dropzone.hint')}
      </p>

      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy
          ? t('workspace.loading')
          : t(multiple ? 'workspace.dropzone.button' : 'workspace.dropzone.button.single')}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple={multiple}
        className="sr-only"
        data-testid="file-input"
        onChange={(event) => {
          onFiles(pdfsFrom(event.target.files));
          // Zerar permite escolher o mesmo arquivo de novo logo em seguida.
          event.target.value = '';
        }}
      />
    </div>
  );
}
