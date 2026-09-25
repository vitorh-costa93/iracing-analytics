"use client";

/** A ação "Atualizar dados", extraída de app/page.tsx (25/09/2026, redesign etapa 1) para o novo
 * cabeçalho global poder dispará-la de qualquer tela. A sequência e as mensagens são as mesmas de
 * antes: sync/all (catálogo/ratings) -> sync/telemetry (CSV de voltas já conhecidas, sem descoberta)
 * -> sync/rating-history. Nenhuma rota nova, nenhum passo novo, mesmo custo por clique.
 *
 * O resultado é anunciado por eventos de janela para que telas que mantêm estado próprio (a Visão
 * Geral recarrega o dashboard) reajam sem acoplar o cabeçalho a elas. */
export const DATA_SYNC_PROGRESS_EVENT = "racing-analytics:data-sync-progress";
export const DATA_SYNC_DONE_EVENT = "racing-analytics:data-sync-done";

export type DataSyncDetail = { message: string; ok?: boolean };

// 11/09/2026 fix (preservado): lê o corpo como texto antes de interpretar, para distinguir timeout da
// Vercel (página HTML) de erro real da rota, em vez de mostrar uma exceção crua do parser de JSON.
async function postSyncStep(url: string, label: string) {
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();
  let parsed: { message?: string; [key: string]: unknown } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      response.ok
        ? `${label}: resposta inesperada do servidor (não era JSON).`
        : `${label}: a Vercel encerrou a chamada antes de terminar (provável timeout). Tente de novo em alguns minutos -- a sincronização é incremental, então nada se perde.`
    );
  }
  if (!response.ok) throw new Error(parsed.message ?? `Erro em ${label}`);
  return parsed;
}

function announce(name: string, detail: DataSyncDetail) {
  window.dispatchEvent(new CustomEvent<DataSyncDetail>(name, { detail }));
}

let running: Promise<DataSyncDetail> | null = null;

/** Executa a sincronização; chamadas concorrentes (dois botões, clique duplo) reaproveitam a mesma
 * execução em vez de competir pelo mesmo rate limit. */
export function runDataSync(): Promise<DataSyncDetail> {
  running ??= (async () => {
    const progress = (message: string) => announce(DATA_SYNC_PROGRESS_EVENT, { message });
    let result: DataSyncDetail;
    try {
      progress("Atualizando dados via Supabase...");
      await postSyncStep("/api/sync/all", "sincronização geral");

      progress("Baixando telemetria de voltas já conhecidas...");
      const telemetryResult = await postSyncStep("/api/sync/telemetry", "sincronização de telemetria");

      progress("Atualizando histórico de Safety Rating do Garage61...");
      const ratingsResult = await postSyncStep("/api/sync/rating-history", "sincronização de ratings");

      const bridgeReady = document.documentElement.dataset.iracingAnalyticsSyncBridge === "ready";
      if (bridgeReady) {
        window.postMessage({ source: "iracing-analytics", type: "start-external-sync" }, window.location.origin);
        result = { ok: true, message: `Preparando fontes do servidor e abrindo Garage61/iRStats para importar a atividade nova. A página será atualizada quando cada origem concluir. ${telemetryResult.telemetryDownloaded ?? 0} telemetria(s) armazenada(s); ${ratingsResult.recordsSynced ?? 0} pontos de Safety Rating verificados.` };
      } else {
        result = { ok: true, message: `Preparação no servidor concluída: ${telemetryResult.telemetryDownloaded ?? 0} telemetria(s) armazenada(s); ${ratingsResult.recordsSynced ?? 0} pontos de Safety Rating verificados. Para sessões, voltas e setups novos, abra Garage61 e clique no favorito de importação do navegador.` };
      }
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Erro na sincronização" };
    }
    announce(DATA_SYNC_DONE_EVENT, result);
    return result;
  })().finally(() => { running = null; });
  return running;
}
