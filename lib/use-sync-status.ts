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
const listeners = new Set<(payload: SyncStatusPayload | null) => void>();

function load() {
  pending ??= fetch("/api/sync/status", { cache: "no-store" })
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
    return () => { alive = false; listeners.delete(listener); };
  }, []);
  return data;
}
