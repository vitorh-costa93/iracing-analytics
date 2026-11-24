"use client";

/** A ação "Atualizar dados" do cabeçalho global: revalida o status das fontes no Supabase
 * (alimentadas pelo RacingAnalyticsAgent) e notifica as telas abertas via DATA_SYNC_DONE_EVENT
 * para recarregarem os painéis sem depender de Garage61/iRStats ou extensão de navegador. */
export const DATA_SYNC_PROGRESS_EVENT = "racing-analytics:data-sync-progress";
export const DATA_SYNC_DONE_EVENT = "racing-analytics:data-sync-done";

export type DataSyncDetail = { message: string; ok?: boolean };

function announce(name: string, detail: DataSyncDetail) {
  window.dispatchEvent(new CustomEvent<DataSyncDetail>(name, { detail }));
}

let running: Promise<DataSyncDetail> | null = null;

/** Revalida o painel a partir do Supabase; cliques concorrentes reaproveitam a mesma execução. */
export function runDataSync(): Promise<DataSyncDetail> {
  running ??= (async () => {
    const progress = (message: string) => announce(DATA_SYNC_PROGRESS_EVENT, { message });
    let result: DataSyncDetail;
    try {
      progress("Verificando dados mais recentes no Supabase...");
      const response = await fetch("/api/sync/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível consultar o status das fontes no servidor.");
      const payload = (await response.json()) as { status?: string; message?: string };
      if (payload.status !== "ok") throw new Error(payload.message ?? "Erro ao verificar fontes no servidor.");
      result = {
        ok: true,
        message: "Painel atualizado com os dados do Supabase. Novas corridas, setups e telemetrias sobem automaticamente pelo RacingAnalyticsAgent.",
      };
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar dados" };
    }
    announce(DATA_SYNC_DONE_EVENT, result);
    return result;
  })().finally(() => { running = null; });
  return running;
}
