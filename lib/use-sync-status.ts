"use client";

import { useEffect, useState } from "react";

/** Contrato de /api/sync/status (app/api/sync/status/route.ts). */
export type SyncStatusPayload = {
  status: string;
  driver?: { name: string; iracingId: string | null } | null;
  sources?: {
    garage61: { lastSuccessAt: string | null; latestStatus: string; latestError: string | null; recentError: { at: string; message: string | null } | null };
    irstats: { lastImportAt: string | null };
    setups: { lastImportAt: string | null };
  };
};

/** Uma única requisição a /api/sync/status por carregamento de página, compartilhada entre o
 * cabeçalho (AppHeader) e o DataFreshness das telas antigas -- os dois leem a mesma promessa em vez
 * de disparar duas chamadas. `refreshSyncStatus()` invalida depois de um "Atualizar dados". */
let pending: Promise<SyncStatusPayload | null> | null = null;
let lastLoadAt = 0;
const listeners = new Set<(payload: SyncStatusPayload | null) => void>();

function load() {
  if (!pending) lastLoadAt = Date.now();
  pending ??= fetch("/api/sync/status")
    .then((response) => response.json() as Promise<SyncStatusPayload>)
    .then((payload) => (payload.status === "ok" ? payload : null))
    .catch(() => null);
  return pending;
}

export function refreshSyncStatus() {
  pending = null;
  void load().then((payload) => listeners.forEach((listener) => listener(payload)));
}

/** `undefined` = ainda carregando; `null` = a rota falhou ou respondeu erro. */
export function useSyncStatus() {
  const [data, setData] = useState<SyncStatusPayload | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const listener = (payload: SyncStatusPayload | null) => { if (alive) setData(payload); };
    listeners.add(listener);
    void load().then(listener);
    const revalidate = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoadAt >= 60_000) refreshSyncStatus();
    };
    const timer = window.setInterval(revalidate, 120_000);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      alive = false; listeners.delete(listener); window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, []);
  return data;
}
