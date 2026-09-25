"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DATA_SYNC_DONE_EVENT, DATA_SYNC_PROGRESS_EVENT, runDataSync, type DataSyncDetail } from "@/lib/data-sync-action";
import { freshnessState, initials, relativeAge } from "@/lib/freshness";
import { refreshSyncStatus, useSyncStatus } from "@/lib/use-sync-status";

/** Cabeçalho fixo do Night Grid (docs/redesign-mockup/B.dc.html): marca, navegação principal,
 * frescura das fontes (a mesma /api/sync/status do DataFreshness, uma requisição por página),
 * "Atualizar dados" (lib/data-sync-action.ts, mesma ação de antes) e identidade do piloto. */
const NAV = [
  { href: "/", label: "Visão Geral", match: (path: string) => path === "/" },
  { href: "/telemetry", label: "Telemetry Lab", match: (path: string) => path.startsWith("/telemetry") },
  { href: "/debriefs", label: "Debriefs", match: (path: string) => path.startsWith("/debriefs") },
  { href: "/setup", label: "Setup Lab", match: (path: string) => path.startsWith("/setup") },
];

const fullDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "sem registro");

export default function AppHeader() {
  const pathname = usePathname() ?? "/";
  const status = useSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<DataSyncDetail | null>(null);
  // Relógio para "há X h" não congelar numa aba aberta por horas; 1 atualização por minuto, só local.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function onProgress(event: Event) {
      setSyncing(true);
      setToast((event as CustomEvent<DataSyncDetail>).detail);
    }
    function onDone(event: Event) {
      setSyncing(false);
      setToast((event as CustomEvent<DataSyncDetail>).detail);
      refreshSyncStatus();
    }
    window.addEventListener(DATA_SYNC_PROGRESS_EVENT, onProgress);
    window.addEventListener(DATA_SYNC_DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(DATA_SYNC_PROGRESS_EVENT, onProgress);
      window.removeEventListener(DATA_SYNC_DONE_EVENT, onDone);
    };
  }, []);

  const sources = status?.sources;
  const state = sources && now !== null
    ? freshnessState({ garage61LastSuccessAt: sources.garage61.lastSuccessAt, garage61LatestStatus: sources.garage61.latestStatus, irstatsLastImportAt: sources.irstats.lastImportAt }, now)
    : "unknown";
  const freshnessText = sources && now !== null
    ? `iRStats ${relativeAge(sources.irstats.lastImportAt, now)} · Garage61 ${relativeAge(sources.garage61.lastSuccessAt, now)}`
    : status === null ? "Fontes indisponíveis" : "Verificando fontes…";
  const freshnessTitle = sources
    ? [
        `iRStats: resultados importados em ${fullDate(sources.irstats.lastImportAt)}`,
        `Garage61: última sincronização útil em ${fullDate(sources.garage61.lastSuccessAt)}`,
        `Setups do Garage61: última importação em ${fullDate(sources.setups.lastImportAt)}`,
        state === "error" ? "A última tentativa do Garage61 falhou; o painel usa o último sync válido." : null,
      ].filter(Boolean).join("\n")
    : undefined;
  const driver = status?.driver ?? null;

  return (
    <>
      <header className="ng-header">
        <Link href="/" className="ng-brand" aria-label="Racing Analytics · Visão Geral">
          <span className="ng-brand-mark" aria-hidden />
          <span className="ng-brand-name">Racing<span> Analytics</span></span>
        </Link>
        <nav className="ng-nav" aria-label="Áreas do Racing Analytics">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.match(pathname) ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
        <div className="ng-header-spacer" />
        <div className="ng-freshness" title={freshnessTitle} aria-live="polite">
          <span className="ng-freshness-dot" data-state={state} aria-hidden />
          <span className="ng-freshness-text">{freshnessText}</span>
        </div>
        <button type="button" className="ng-button" disabled={syncing} onClick={() => void runDataSync()}>
          {syncing ? "Atualizando…" : "Atualizar dados"}
        </button>
        {driver && (
          <div className="ng-driver">
            <div className="ng-driver-text">
              <div className="ng-driver-name">{driver.name}</div>
              {driver.iracingId && <div className="ng-driver-id">ID {driver.iracingId}</div>}
            </div>
            <div className="ng-avatar" title={driver.iracingId ? `${driver.name} · ID ${driver.iracingId}` : driver.name}>{initials(driver.name)}</div>
          </div>
        )}
      </header>
      {/* Na Visão Geral o aviso já aparece no banner da própria tela (até a etapa 2 migrá-la). */}
      {toast && pathname !== "/" && (
        <div className="ng-sync-toast" role="status">
          <span>{toast.message}</span>
          {!syncing && <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso">Fechar</button>}
        </div>
      )}
    </>
  );
}
