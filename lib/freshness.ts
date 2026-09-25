/** Texto curto de frescura das fontes para o cabeçalho do Night Grid ("iRStats há 2 h · Garage61
 * há 9 h", docs/redesign-mockup/B.dc.html). Puro, para ser testável. */
export function relativeAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "sem registro";
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "sem registro";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

export type FreshnessState = "ok" | "stale" | "error" | "unknown";

/** Garage61 tem cron diário (09:00 UTC), então mais de 36 h sem sync útil já é atraso real; o
 * iRStats depende do favorito manual, então só vira alerta depois de 7 dias. Uma falha na última
 * tentativa do Garage61 tem prioridade (o painel segue usando o último sync válido). */
export function freshnessState(input: { garage61LastSuccessAt: string | null; garage61LatestStatus: string; irstatsLastImportAt: string | null }, now: number = Date.now()): FreshnessState {
  if (input.garage61LatestStatus === "error") return "error";
  if (!input.garage61LastSuccessAt && !input.irstatsLastImportAt) return "unknown";
  const age = (iso: string | null) => (iso ? now - new Date(iso).getTime() : Number.POSITIVE_INFINITY);
  if (age(input.garage61LastSuccessAt) > 36 * 3_600_000 || age(input.irstatsLastImportAt) > 7 * 24 * 3_600_000) return "stale";
  return "ok";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}
