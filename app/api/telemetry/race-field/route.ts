import { CACHE_TAGS, cachedJson } from "@/lib/cache";
import { withDurableCache } from "@/lib/durable-cache";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRaceFieldView, raceClassRows, recurringRivals, trackHistory, type FieldEvent, type FieldRow, type RivalEvent, type RivalRow, type TrackRow } from "@/lib/race-field";

/**
 * Campo da corrida (Race Debrief): agregados de race_field_events/race_field_results (agente iRacing).
 * GET ?subsessionId=N               -> 4 seções da corrida + histórico da pista (mesma pista e classe)
 * GET ?view=rivals&category=&weeks= -> rivais recorrentes da categoria na janela
 *
 * PERMANENT GUARD-RAIL (CLAUDE.md regra #7; plano Free, já houve incidente de egress) -- não remover
 * nem aumentar limites/TTL sem pedido explícito:
 * - cache de resposta em memória por instância, com TTL e teto de entradas (mesmo padrão de
 *   app/api/dashboard/report/route.ts); o cliente não faz polling;
 * - respostas pequenas: só agregados saem desta rota, nunca linhas brutas;
 * - só as colunas usadas, sempre filtradas por subsession_id (chave primária) ou por track_id /
 *   license_category + janela, com limite explícito de linhas e de corridas por consulta;
 * - nunca varre a tabela inteira: rivais limitados a RIVAL_MAX_EVENTS corridas e RIVAL_MAX_ROWS linhas;
 *   histórico por pista limitado a TRACK_MAX_RACES corridas.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELD_TTL_MS = 5 * 60_000, RIVALS_TTL_MS = 10 * 60_000, EMPTY_TTL_MS = 60_000, CACHE_MAX_ENTRIES = 60;
const TRACK_MAX_RACES = 16, FIELD_MAX_ROWS = 300, TRACK_MAX_ROWS = 1000;
const RIVAL_MAX_EVENTS = 120, RIVAL_MAX_ROWS = 6000, RIVAL_PAGE = 1000;
const CATEGORIES = ["sports_car", "formula_car", "road"], WEEK_OPTIONS = [4, 8, 16, 26];

const cache = new Map<string, { expiresAt: number; payload: unknown }>();
function remember(key: string, payload: unknown, ttl: number) {
  if (cache.size >= CACHE_MAX_ENTRIES) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(key, { expiresAt: Date.now() + ttl, payload });
}
const respond = (payload: unknown, ttl: number) => { const ok = (payload as { status?: string } | null)?.status === "ok"; return cachedJson(payload, { sMaxAge: ok ? Math.floor(ttl / 1000) : 60, swr: ok ? 3600 : 0, tags: [CACHE_TAGS.laps, CACHE_TAGS.results] }); };
function fail(source: string, error: unknown): never {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  throw new Error(`${source}: ${typeof value.message === "string" ? value.message : String(error)}`);
}

const EVENT_COLUMNS = "subsession_id,track_id,track_name,race_week,sof,num_drivers,num_cautions,num_caution_laps,num_lead_changes,weather,session_splits";
const ROW_COLUMNS = "sim_session_type,cust_id,display_name,country_code,car_class_id,car_class_name,starting_position_in_class,finish_position_in_class,laps_complete,laps_lead,incidents,best_lap_time,average_lap,qual_lap_time,oldi_rating,newi_rating,reason_out,is_me";
const RIVAL_COLUMNS = "subsession_id,cust_id,display_name,country_code,car_class_id,starting_position_in_class,finish_position_in_class,laps_complete,incidents,best_lap_time,oldi_rating,newi_rating,is_me";

async function fieldView(subsessionId: number) {
  const key = `field:${subsessionId}`, cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const { data: event, error } = await supabaseAdmin.from("race_field_events").select(EVENT_COLUMNS).eq("subsession_id", subsessionId).maybeSingle();
  if (error) fail("race_field_events", error);
  if (!event) { const payload = { status: "empty", message: "Campo ainda não importado para esta corrida." }; remember(key, payload, EMPTY_TTL_MS); return payload; }
  // Treino não é usado em nenhuma seção: só corrida e classificação saem do banco.
  const { data: rows, error: rowsError } = await supabaseAdmin.from("race_field_results").select(ROW_COLUMNS)
    .eq("subsession_id", subsessionId).in("sim_session_type", ["race", "qualify"]).limit(FIELD_MAX_ROWS);
  if (rowsError) fail("race_field_results", rowsError);
  const fieldRows = (rows ?? []) as unknown as FieldRow[], fieldEvent = event as unknown as FieldEvent & { track_name: string; track_id: number };
  const view = buildRaceFieldView(fieldEvent, fieldRows);
  view.trackName = fieldEvent.track_name;
  const classId = raceClassRows(fieldRows).classRows.find((row) => row.is_me)?.car_class_id ?? null;
  if (classId !== null && fieldEvent.track_id) view.trackHistory = await trackHistoryFor(fieldEvent.track_id, classId);
  remember(key, view, FIELD_TTL_MS);
  return view;
}

/** Mesma pista e classe, últimas TRACK_MAX_RACES corridas: só (subsession, cust, classe, melhor volta, is_me). */
async function trackHistoryFor(trackId: number, classId: number) {
  const key = `track:${trackId}:${classId}`, cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload as ReturnType<typeof trackHistory>;
  const { data: events, error } = await supabaseAdmin.from("race_field_events").select("subsession_id,start_time,race_week")
    .eq("track_id", trackId).order("start_time", { ascending: false }).limit(TRACK_MAX_RACES);
  if (error) fail("race_field_events(track)", error);
  const list = (events ?? []) as { subsession_id: number; start_time: string; race_week: number | null }[];
  let history: ReturnType<typeof trackHistory> = { points: [], trend: null };
  if (list.length) {
    const { data: rows, error: rowsError } = await supabaseAdmin.from("race_field_results").select("subsession_id,cust_id,car_class_id,best_lap_time,is_me")
      .in("subsession_id", list.map((event) => event.subsession_id)).eq("sim_session_type", "race").eq("car_class_id", classId).not("best_lap_time", "is", null).limit(TRACK_MAX_ROWS);
    if (rowsError) fail("race_field_results(track)", rowsError);
    history = trackHistory(list, (rows ?? []) as unknown as TrackRow[], classId);
  }
  remember(key, history, FIELD_TTL_MS);
  return history;
}

async function rivalsView(category: string, weeks: number) {
  const key = `rivals:${category}:${weeks}`, cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const since = new Date(Date.now() - weeks * 7 * 86400000).toISOString();
  const { data: events, error } = await supabaseAdmin.from("race_field_events").select("subsession_id,start_time,track_name")
    .eq("license_category", category).gte("start_time", since).order("start_time", { ascending: false }).limit(RIVAL_MAX_EVENTS);
  if (error) fail("race_field_events(rivals)", error);
  const list = (events ?? []) as RivalEvent[];
  let payload: unknown;
  if (!list.length) payload = { status: "empty", message: "Campo ainda não importado para esta categoria e janela." };
  else {
    const ids = list.map((event) => event.subsession_id), rows: RivalRow[] = [];
    for (let from = 0; from < RIVAL_MAX_ROWS; from += RIVAL_PAGE) {
      const { data, error: rowsError } = await supabaseAdmin.from("race_field_results").select(RIVAL_COLUMNS)
        .in("subsession_id", ids).eq("sim_session_type", "race").order("subsession_id", { ascending: true }).order("cust_id", { ascending: true }).range(from, from + RIVAL_PAGE - 1);
      if (rowsError) fail("race_field_results(rivals)", rowsError);
      rows.push(...((data ?? []) as unknown as RivalRow[]));
      if (!data || data.length < RIVAL_PAGE) break;
    }
    const mine = rows.filter((row) => row.is_me);
    payload = { status: "ok", category, weeks, truncated: rows.length >= RIVAL_MAX_ROWS, ...recurringRivals(list, mine, rows) };
  }
  remember(key, payload, RIVALS_TTL_MS);
  return payload;
}

async function handleGet(request: NextRequest) {
  cache.clear();
  try {
    const params = request.nextUrl.searchParams;
    if (params.get("view") === "rivals") {
      const category = params.get("category") ?? "", weeks = Number(params.get("weeks") ?? 8);
      if (!CATEGORIES.includes(category) || !WEEK_OPTIONS.includes(weeks)) return NextResponse.json({ status: "error", message: "Parâmetros inválidos." }, { status: 400 });
      return respond(await rivalsView(category, weeks), RIVALS_TTL_MS);
    }
    const subsessionId = Number(params.get("subsessionId"));
    if (!Number.isSafeInteger(subsessionId) || subsessionId <= 0) return NextResponse.json({ status: "error", message: "subsessionId inválido." }, { status: 400 });
    return respond(await fieldView(subsessionId), FIELD_TTL_MS);
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "Erro ao montar o campo da corrida." }, { status: 500 });
  }
}

export const GET = withDurableCache(handleGet, { version: "race-field-v1", tags: [CACHE_TAGS.results, CACHE_TAGS.laps], ttlSeconds: 300 });
