"use client";
import { AlertTriangle, CheckCircle2, Clock3, Database } from "lucide-react";
import { useSyncStatus } from "@/lib/use-sync-status";
const date = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "sem registro";
export default function DataFreshness({ surface }: { surface: "telemetry" | "setup" }) {
  // Mesma requisição do cabeçalho (lib/use-sync-status.ts), não uma segunda chamada.
  const data = useSyncStatus();
  if (!data?.sources) return null;
  const { garage61, irstats, setups } = data.sources;
  const failed = garage61.latestStatus === "error";
  const hadRecentFailure = Boolean(garage61.recentError);
  const secondary = surface === "telemetry" ? `iRStats: resultados importados em ${date(irstats.lastImportAt)}` : `Garage61 setups: última importação em ${date(setups.lastImportAt)}`;
  return <aside className={`data-freshness ${failed ? "has-error" : ""}`} aria-live="polite"><div><Database size={16} /><strong>Estado das fontes</strong></div><span><Clock3 size={14} />Garage61: última sincronização útil em {date(garage61.lastSuccessAt)}</span><span>{failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{secondary}</span>{failed && <small>Última tentativa do Garage61 falhou; o painel usa o último sync válido.</small>}{!failed && hadRecentFailure && <small>Houve uma falha recente no Garage61; o último sync válido foi preservado.</small>}</aside>;
}
