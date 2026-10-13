import { supabaseAdmin } from "@/lib/supabase-admin";
import type { RaceInput } from "@/lib/race-engineer-analysis";
import { classifyExit, EARLY_EXIT_RATIO, raceFieldMetrics, type ExitCause, type ExitLap, type FieldResultRow, type RaceFieldMetric } from "@/lib/debrief-field";

/**
 * Leituras do Supabase dos Debriefs que alimentam lib/debrief-field.ts. Guard-rails de cota (CLAUDE.md
 * regra #7): só colunas leves de race_field_results, só as corridas do recorte (lotes de 40), nunca
 * as linhas do campo para o navegador; as voltas só são lidas para as poucas corridas que terminaram
 * cedo (uma consulta limitada por corrida). O resultado final entra no cache de 120 s do relatório.
 */
const CHUNK = 40;
const SELECT = "subsession_id,cust_id,car_class_id,laps_complete,best_lap_time,oldi_rating,newi_rating,finish_position_in_class,is_me";
const fail = (source: string, error: unknown): never => { const value = error && typeof error === "object" ? (error as Record<string, unknown>) : {}; throw new Error(source + ": " + (typeof value.message === "string" ? value.message : String(error))); };

export async function fieldMetricsFor(races: RaceInput[]): Promise<Map<number, RaceFieldMetric>> {
  const ids = [...new Set(races.map((race) => race.irstats_race_id).filter((id): id is number => typeof id === "number"))];
  const rows: FieldResultRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin.from("race_field_results").select(SELECT).eq("sim_session_type", "race").in("subsession_id", ids.slice(i, i + CHUNK)).order("subsession_id", { ascending: true }).order("cust_id", { ascending: true }).range(from, from + 999);
      if (error) fail("race_field_results", error);
      rows.push(...((data ?? []) as FieldResultRow[]));
      if (!data || data.length < 1000) break;
    }
  }
  return raceFieldMetrics(rows);
}

const WINDOW_MS = 3 * 3600 * 1000;
type LapRow = ExitLap & { start: string | null; event: string | null };
/** Causa provável de cada corrida que terminou cedo (<90% das voltas). Uma consulta pequena por saída:
 * voltas de corrida do mesmo carro e pista iniciadas até 3 h do horário da corrida. */
export async function exitCauses(driverId: string, races: RaceInput[], metrics: Map<number, RaceFieldMetric>): Promise<Map<number, ExitCause | null>> {
  const out = new Map<number, ExitCause | null>();
  const exits = races.filter((race) => {
    const metric = race.irstats_race_id == null ? undefined : metrics.get(race.irstats_race_id);
    return metric && metric.lapsRatio !== null && metric.lapsRatio < EARLY_EXIT_RATIO && metric.lapsComplete > 1 && race.car_id != null && race.track_id != null;
  });
  for (const race of exits.slice(0, 40)) {
    const id = race.irstats_race_id as number, metric = metrics.get(id) as RaceFieldMetric, at = new Date(race.raced_at).getTime();
    const { data, error } = await supabaseAdmin.from("laps")
      .select("lap_number,lap_time,off_track,pit_in,pit_out,start:garage61_payload->>startTime,event:garage61_payload->>event")
      .eq("driver_id", driverId).eq("car_id", race.car_id as number).eq("track_id", race.track_id as number)
      .eq("garage61_payload->>sessionType", "3")
      .gte("garage61_payload->>startTime", new Date(at - WINDOW_MS).toISOString()).lte("garage61_payload->>startTime", new Date(at + WINDOW_MS).toISOString())
      .order("lap_number", { ascending: true }).limit(400);
    if (error) fail("laps", error);
    const rows = (data ?? []) as unknown as LapRow[];
    // Uma sessão só: a do evento com mais voltas (o piloto pode ter treinado no mesmo carro e pista).
    const byEvent = new Map<string, LapRow[]>();
    for (const lap of rows) byEvent.set(lap.event ?? "", [...(byEvent.get(lap.event ?? "") ?? []), lap]);
    const session = [...byEvent.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    out.set(id, classifyExit(metric.lapsComplete, session));
  }
  return out;
}
