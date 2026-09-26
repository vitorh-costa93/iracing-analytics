/**
 * Voltas da corrida para o Race Debrief (redesign etapa 4, 26/09/2026): quais entram no ritmo e quais
 * ficam de fora, com o motivo em linguagem de pista. Só recebe voltas de CORRIDA (sessionType 3 do
 * evento Garage61; a rota filtra antes).
 */
export type RaceLapRow = {
  id: string;
  lap_number: number | null;
  lap_time: number | null;
  clean: boolean | null;
  off_track: boolean | null;
  pit_in: boolean | null;
  pit_out: boolean | null;
  pit_lane: boolean | null;
  incomplete: boolean | null;
  missing: boolean | null;
  telemetry_path: string | null;
};

export type RaceLap = { id: string; lapNumber: number | null; lapTime: number; telemetryPath: string | null };
export type DiscardedLap = { lapNumber: number | null; lapTime: number; reason: string };

const OUTLIER_Z = 2.5;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Separa as voltas limpas (ritmo) das descartadas, com motivo. Volta sem tempo, incompleta ou de
 * número 0 (antes da largada) some sem aparecer na lista. */
export function classifyRaceLaps(rows: RaceLapRow[]): { kept: RaceLap[]; discarded: DiscardedLap[] } {
  const discarded: DiscardedLap[] = [];
  const candidates: RaceLap[] = [];
  for (const row of rows) {
    const lapTime = Number(row.lap_time);
    if (!(lapTime > 0) || row.incomplete || row.missing) continue;
    if (row.lap_number !== null && row.lap_number <= 0) continue;
    const lap: RaceLap = { id: row.id, lapNumber: row.lap_number, lapTime, telemetryPath: row.telemetry_path };
    if (row.lap_number === 1) discarded.push({ lapNumber: 1, lapTime, reason: "largada" });
    else if (row.pit_in || row.pit_out || row.pit_lane) discarded.push({ lapNumber: row.lap_number, lapTime, reason: "entrada ou saída dos boxes" });
    else if (row.off_track) discarded.push({ lapNumber: row.lap_number, lapTime, reason: "saída de pista" });
    else if (row.clean === false) discarded.push({ lapNumber: row.lap_number, lapTime, reason: "incidente registrado" });
    else candidates.push(lap);
  }

  let kept = candidates;
  if (candidates.length >= 5) {
    const times = candidates.map((lap) => lap.lapTime);
    const med = median(times);
    const scaled = (median(times.map((value) => Math.abs(value - med))) || 0.001) * 1.4826;
    kept = [];
    for (const lap of candidates) {
      const z = (lap.lapTime - med) / scaled;
      if (z > OUTLIER_Z) discarded.push({ lapNumber: lap.lapNumber, lapTime: lap.lapTime, reason: "volta lenta: tráfego, toque ou erro" });
      else if (z < -OUTLIER_Z) discarded.push({ lapNumber: lap.lapNumber, lapTime: lap.lapTime, reason: "rápida demais para o seu ritmo (provável vácuo ou P2P)" });
      else kept.push(lap);
    }
  }
  discarded.sort((a, b) => (a.lapNumber ?? 0) - (b.lapNumber ?? 0));
  return { kept, discarded };
}

/** "1:18.395" ou "78.395" em segundos. */
export function parseLapTimeText(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2].replace(",", ".")) + (match[1] ? Number(match[1]) * 60 : 0);
  return seconds > 0 ? seconds : null;
}

/** Identidade do conjunto de voltas com telemetria: muda quando chega telemetria nova da corrida. */
export function lapSetKey(rows: Pick<RaceLapRow, "id" | "telemetry_path">[]) {
  const ids = rows.filter((row) => row.telemetry_path).map((row) => row.id).sort();
  let hash = 0;
  for (const id of ids) for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `${rows.length}:${ids.length}:${(hash >>> 0).toString(36)}`;
}
