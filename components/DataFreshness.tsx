"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database } from "lucide-react";
type Payload = { status: string; sources?: { garage61: { lastSuccessAt: string | null; latestStatus: string; latestError: string | null; recentError: { at: string; message: string | null } | null }; irstats: { lastImportAt: string | null }; setups: { lastImportAt: string | null } } };
const date = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "sem registro";
export default function DataFreshness({ surface }: { surface: "telemetry" | "setup" }) {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { fetch("/api/sync/status", { cache: "no-store" }).then((response) => response.json()).then((payload) => { if (payload.status === "ok") setData(payload); }).catch(() => undefined); }, []);
  if (!data?.sources) return null;
  const { garage61, irstats, setups } = data.sources;
  const failed = garage61.latestStatus === "error";
  const hadRecentFailure = Boolean(garage61.recentError);
  const secondary = surface === "telemetry" ? `iRStats: resultados importados em ${date(irstats.lastImportAt)}` : `Garage61 setups: última importação em ${date(setups.lastImportAt)}`;
  return <aside className={`data-freshness ${failed ? "has-error" : ""}`} aria-live="polite"><div><Database size={16} /><strong>Estado das fontes</strong></div><span><Clock3 size={14} />Garage61: última sincronização útil em {date(garage61.lastSuccessAt)}</span><span>{failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{secondary}</span>{failed && <small>Última tentativa do Garage61 falhou; o painel usa o último sync válido.</small>}{!failed && hadRecentFailure && <small>Houve uma falha recente no Garage61; o último sync válido foi preservado.</small>}</aside>;
}
