'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileSignature, ShieldCheck, X } from 'lucide-react';
import { signErrorKey, useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toPageRefs } from '@/workspace/model';
import { useWorkspaceStore } from '@/workspace/store';
import { useWorkspaceServices, WorkspaceServicesProvider } from '@/workspace/services';
import { createSignSession, type SignSession } from '@/workers/sign-client';
import type { CertificateInfo } from '@/workers/sign-protocol';
import { WorkspaceShell } from './workspace-shell';
import { useGeneration } from '@/lib/generation';
import { GenerationAction } from './generation-action';
import { getTool } from '@/tools/registry';

interface SignToolState {
  readonly certificate: CertificateInfo | null;
  /** Se ja houve uma assinatura nesta sessao. Os bytes ficam com a geracao. */
  readonly signed: boolean;
  readonly busy: boolean;
  readonly error: string | null;
}

/**
 * Assinatura digital com certificado A1.
 *
 * Painel e acao vivem no mesmo componente porque compartilham a sessao de assinatura — o
 * worker que detem a chave. Espalhar isso por um contexto tornaria menos evidente onde o
 * material sensivel existe e quando ele deixa de existir.
 */
function SignToolInner() {
  const { t, locale } = useTranslation();
  const generation = useGeneration();
  const services = useWorkspaceServices();
  const items = useWorkspaceStore((state) => state.items);

  const sessionRef = useRef<SignSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pfxName, setPfxName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [state, setState] = useState<SignToolState>({
    certificate: null,
    signed: false,
    busy: false,
    error: null,
  });

  /** Encerra a sessao: o worker morre, e com ele a chave privada e a senha. */
  const endSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setPfxName(null);
    setPassphrase('');
    setState((current) => ({ ...current, certificate: null }));
  }, []);

  // Sair da tela tambem encerra a sessao: nao ha caminho em que o worker sobreviva a ela.
  useEffect(() => endSession, [endSession]);

  const handleLoad = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (file === undefined) return;

    setState((current) => ({ ...current, busy: true, error: null, signed: false }));
    sessionRef.current?.dispose();

    const session = createSignSession();
    sessionRef.current = session;

    try {
      const bytes = await file.arrayBuffer();
      // O buffer e transferido: a partir daqui a interface fica sem os bytes do certificado.
      const certificate = await session.loadCertificate(bytes, passphrase);
      setPfxName(file.name);
      setState({ certificate, signed: false, busy: false, error: null });
    } catch (cause) {
      session.dispose();
      sessionRef.current = null;
      setState({ certificate: null, signed: false, busy: false, error: t(signErrorKey(cause)) });
    }
  }, [passphrase, t]);

  const handleSign = useCallback(() => {
    const session = sessionRef.current;
    if (session === null || services === null || items.length === 0) return;

    generation.run({
      suggestedName: 'pdfkitty-assinado.pdf',
      produce: async () => {
        try {
          const composed = await services.documents.compose(toPageRefs(items));
          const buffer = await composed.arrayBuffer();
          const signed = await session.sign(buffer, reason, location);

          // Assinou: a sessao acaba aqui. Manter o worker vivo prolongaria a existencia da
          // chave privada em memoria sem necessidade.
          endSession();
          setState({ certificate: null, signed: true, busy: false, error: null });
          return signed;
        } catch (cause) {
          // O erro de assinatura tem vocabulario proprio (senha invalida, certificado
          // invalido) e nao pode virar a mensagem generica do nucleo.
          setState((current) => ({ ...current, busy: false, error: t(signErrorKey(cause)) }));
          throw cause;
        }
      },
    });
  }, [services, items, reason, location, endSession, generation, t]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const panel = (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('sign.title')}
      </h2>
      <p className="text-sm text-neutral-500">{t('sign.description')}</p>
      <p className="text-sm text-emerald-700 dark:text-emerald-400">{t('sign.localOnly')}</p>

      {state.certificate === null ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('sign.certificate')}
            <input
              ref={fileRef}
              type="file"
              accept=".pfx,.p12"
              data-testid="pfx-input"
              className="text-xs file:mr-2 file:rounded file:border file:border-neutral-300 file:bg-transparent file:px-2 file:py-1 dark:file:border-neutral-700"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t('sign.passphrase')}
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="off"
              data-testid="passphrase-input"
              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            />
          </label>

          <Button onClick={() => void handleLoad()} disabled={state.busy} data-testid="load-cert">
            <ShieldCheck />
            {state.busy ? t('sign.loading') : t('sign.load')}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 text-sm" data-testid="cert-info">
          <p className="truncate text-xs text-neutral-500" title={pfxName ?? ''}>
            {pfxName}
          </p>
          <p>
            <span className="text-neutral-500">{t('sign.subject')}: </span>
            {state.certificate.subject}
          </p>
          <p>
            <span className="text-neutral-500">{t('sign.issuer')}: </span>
            {state.certificate.issuer}
          </p>
          <p className="tabular-nums">
            <span className="text-neutral-500">{t('sign.validity')}: </span>
            {formatDate(state.certificate.validFrom)} — {formatDate(state.certificate.validUntil)}
          </p>

          {state.certificate.expired && (
            <p className="text-amber-700 dark:text-amber-400" data-testid="cert-expired">
              {t('sign.expired')}
            </p>
          )}

          <label className="flex flex-col gap-1">
            {t('sign.reason')}
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="reason-input"
              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t('sign.location')}
            <input
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              data-testid="location-input"
              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            />
          </label>

          <Button variant="danger" size="sm" onClick={endSession} data-testid="remove-cert">
            <X />
            {t('sign.remove')}
          </Button>
        </div>
      )}

      {state.error !== null && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="sign-error">
          {state.error}
        </p>
      )}

      {state.signed && (
        <div className="flex flex-col gap-2" data-testid="sign-result">
          <p className="text-sm">{t('sign.done')}</p>
          <p className="text-xs text-neutral-500">{t('sign.sessionEnded')}</p>
        </div>
      )}
    </section>
  );

  const action = (
    <GenerationAction
      generation={generation}
      icon={FileSignature}
      labelKey="sign.run"
      runningLabelKey="sign.running"
      disabled={state.certificate === null || items.length === 0 || state.busy}
      testId="sign-run"
      onRun={handleSign}
    />
  );

  return <WorkspaceShell titleKey={getTool('assinar').nameKey} panel={panel} action={action} />;
}

export function SignTool() {
  return (
    <WorkspaceServicesProvider>
      <SignToolInner />
    </WorkspaceServicesProvider>
  );
}
