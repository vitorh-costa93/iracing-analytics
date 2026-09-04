import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 05/09/2026: "comportar como se fosse meu engenheiro... cruzando informações de todas as
// páginas... isso se atualiza toda vez que eu atualizo os resultados" -- sempre force-dynamic e
// nunca cacheado: o relatório precisa refletir o resultado mais recente assim que o piloto
// sincroniza, exatamente como app/api/dashboard/overview/route.ts já faz pelo mesmo motivo.
export const dynamic = "force-dynamic";

type Category = "formula_car" | "sports_car";
const CATEGORIES: Category[] = ["formula_car", "sports_car"];

type RaceRow = {
  raced_at: string;
  category: Category;
  series_name: string;
  track_name: string;
  car_name: string;
  season_week: number | null;
  finish_position: number;
  irating_after: number;
  irating_before: number;
  sof: number | null;
  incidents: number | null;
};

function throwSupabaseError(source: string, error: unknown): never {
  const obj = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const message = obj && typeof obj.message === "string" ? obj.message : String(error);
  throw new Error(`${source}: ${message}`);
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function fmt1(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function categoryLabel(category: Category): string {
  return category === "formula_car" ? "Formula Car" : "Sports Car";
}

/** Highest/lowest single-race Δ iRating in a set, with enough context (car/track) to name it in
 * prose -- the "ponto alto / ponto baixo" the driver asked for, not just an aggregate number. */
function pickExtreme(rows: RaceRow[], direction: "max" | "min") {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => direction === "max"
    ? (b.irating_after - b.irating_before) - (a.irating_after - a.irating_before)
    : (a.irating_after - a.irating_before) - (b.irating_after - b.irating_before));
  const row = sorted[0];
  return { delta: row.irating_after - row.irating_before, car: row.car_name, track: row.track_name, racedAt: row.raced_at, series: row.series_name };
}

/** Season-scoped (not career-wide) "onde você mais ganhou/perdeu" -- v_historical_performance is
 * career-long, which would bury a strong or weak stretch that's specific to THIS season under
 * years of history. Grouped by track+car, same grain as that view, just windowed to the races
 * already loaded for this report. */
function bestWorstContext(rows: RaceRow[]) {
  const groups = new Map<string, { track: string; car: string; races: number; total: number }>();
  for (const row of rows) {
    const key = `${row.track_name}::${row.car_name}`;
    const entry = groups.get(key) ?? { track: row.track_name, car: row.car_name, races: 0, total: 0 };
    entry.races += 1;
    entry.total += row.irating_after - row.irating_before;
    groups.set(key, entry);
  }
  const withEnoughSample = [...groups.values()].filter((g) => g.races >= 2).map((g) => ({ ...g, avgDelta: g.total / g.races }));
  if (!withEnoughSample.length) return { best: null, worst: null };
  const sorted = [...withEnoughSample].sort((a, b) => b.avgDelta - a.avgDelta);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

function buildCategorySeasonNarrative(opts: {
  category: Category;
  currentRaces: RaceRow[];
  previousRaces: RaceRow[];
  currentIrating: number | null;
  seasonStartIrating: number | null;
  currentSR: number | null;
  seasonStartSR: number | null;
  streakCurrent: number;
  streakBest: number;
}): string[] {
  const { category, currentRaces, previousRaces, currentIrating, seasonStartIrating, currentSR, seasonStartSR, streakCurrent, streakBest } = opts;
  const label = categoryLabel(category);
  const paragraphs: string[] = [];
  if (!currentRaces.length) {
    paragraphs.push(`${label}: nenhuma corrida registrada nesta season ainda.`);
    return paragraphs;
  }

  const wins = currentRaces.filter((r) => r.finish_position === 1).length;
  const previousWins = previousRaces.filter((r) => r.finish_position === 1).length;
  const podiums = currentRaces.filter((r) => r.finish_position <= 3).length;
  const netIrating = seasonStartIrating !== null && currentIrating !== null ? currentIrating - seasonStartIrating : null;
  const previousNetIrating = previousRaces.length
    ? previousRaces[previousRaces.length - 1].irating_after - previousRaces[0].irating_before
    : null;
  const srChange = currentSR !== null && seasonStartSR !== null ? currentSR - seasonStartSR : null;

  const opening = `${label}: ${currentRaces.length} corrida${currentRaces.length === 1 ? "" : "s"} nesta season, ${wins} vitória${wins === 1 ? "" : "s"}${podiums > wins ? ` (${podiums} pódios no total)` : ""}, iRating ${netIrating === null ? "sem variação calculável" : `${fmt1(netIrating)} no total`}${currentIrating !== null ? ` (atual: ${currentIrating.toLocaleString("pt-BR")})` : ""}.`;
  paragraphs.push(opening);

  // 05/09/2026: o exemplo que o piloto deu de propósito ("mais vitórias essa temporada, mas o
  // iRating caiu muito") -- checa exatamente essa tensão vitórias × iRating antes de qualquer
  // outra coisa, porque é o tipo de contradição que um número isolado nunca mostra sozinho.
  if (netIrating !== null && previousNetIrating !== null) {
    const winsUp = wins > previousWins;
    const winsDown = wins < previousWins;
    const iratingUp = netIrating > 0;
    const iratingDown = netIrating < 0;
    if (winsUp && iratingDown) {
      paragraphs.push(`Isso é uma contradição que vale investigar: você teve mais vitórias que na season anterior (${wins} vs. ${previousWins}), mas o iRating caiu ${fmt1(netIrating)} no total. Isso normalmente aponta pra um SoF mais fraco nas corridas que você venceu (ganhar contra um grid mais fraco rende menos, ou até perde pontos se você já estava acima da força média do grid) — ou pra inconsistência: vitórias isoladas em corridas boas, cercadas de quedas maiores em corridas ruins. Vale olhar o SoF médio das corridas que você venceu comparado às que perdeu.`);
    } else if (winsDown && iratingUp) {
      paragraphs.push(`Sinal positivo silencioso: você teve menos vitórias que na season anterior (${wins} vs. ${previousWins}), mas o iRating subiu ${fmt1(netIrating)} — indica que os resultados sem vitória ainda estão vindo de grids mais fortes ou com posições melhores no geral, não só picos isolados.`);
    } else if (winsUp && iratingUp) {
      paragraphs.push(`Season em alta nos dois sentidos: mais vitórias (${wins} vs. ${previousWins}) e iRating subindo (${fmt1(netIrating)}) — consistência real, não só sorte pontual.`);
    } else if (winsDown && iratingDown) {
      paragraphs.push(`Season mais dura que a anterior nos dois sentidos: menos vitórias (${wins} vs. ${previousWins}) e iRating caindo (${fmt1(netIrating)}). Vale olhar se mudou de série/carro/SoF, ou se é queda de ritmo mesmo.`);
    }
  }

  if (srChange !== null) {
    paragraphs.push(srChange >= 0
      ? `Safety Rating estável ou subindo (${fmt1(srChange)} na season), sem sinal de limpeza de pilotagem se deteriorando junto com o resultado.`
      : `Safety Rating caiu ${fmt1(srChange)} na season — combinado com o resultado em iRating, vale checar se incidentes estão custando tanto rating quanto pace.`);
  }

  if (streakCurrent > 0) {
    paragraphs.push(`Sequência ativa: ${streakCurrent} corrida${streakCurrent === 1 ? "" : "s"} seguidas ganhando iRating (recorde all-time: ${streakBest}).`);
  } else {
    paragraphs.push(`Sem sequência ativa no momento — a última corrida ${label === "Formula Car" ? "de Formula Car" : "de Sports Car"} perdeu iRating (recorde all-time: ${streakBest} corridas seguidas).`);
  }

  const { best, worst } = bestWorstContext(currentRaces);
  if (best && worst && best !== worst) {
    paragraphs.push(`Onde você mais ganha: ${best.car} em ${best.track} (${fmt1(best.avgDelta)}/corrida em ${best.races} corridas). Onde mais perde: ${worst.car} em ${worst.track} (${fmt1(worst.avgDelta)}/corrida em ${worst.races} corridas).`);
  }

  const bestRace = pickExtreme(currentRaces, "max");
  const worstRace = pickExtreme(currentRaces, "min");
  if (bestRace && worstRace) {
    paragraphs.push(`Melhor corrida isolada da season: ${bestRace.car} em ${bestRace.track} (${fmt1(bestRace.delta)}, ${new Date(bestRace.racedAt).toLocaleDateString("pt-BR")}). Pior: ${worstRace.car} em ${worstRace.track} (${fmt1(worstRace.delta)}, ${new Date(worstRace.racedAt).toLocaleDateString("pt-BR")}).`);
  }

  const withSof = currentRaces.filter((r) => r.sof !== null);
  const withIncidents = currentRaces.filter((r) => r.incidents !== null);
  if (withSof.length >= 4) {
    const avgSof = avg(withSof.map((r) => r.sof as number));
    paragraphs.push(`SoF médio enfrentado nesta season: ${avgSof?.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}.`);
  }
  if (withIncidents.length >= 4) {
    const clean = withIncidents.filter((r) => r.incidents === 0).length;
    const pct = Math.round((clean / withIncidents.length) * 100);
    paragraphs.push(`Corridas limpas (0 incidentes): ${clean} de ${withIncidents.length} (${pct}%).`);
  }

  return paragraphs;
}

function buildCategoryWeekNarrative(opts: {
  category: Category;
  week: number | null;
  weekRaces: RaceRow[];
  previousSameWeekRaces: RaceRow[];
}): string[] {
  const { category, week, weekRaces, previousSameWeekRaces } = opts;
  const label = categoryLabel(category);
  if (week === null || !weekRaces.length) {
    return [`${label}: sem corridas registradas nas últimas semanas da season atual.`];
  }
  const paragraphs: string[] = [];
  const wins = weekRaces.filter((r) => r.finish_position === 1).length;
  const netDelta = weekRaces.reduce((sum, r) => sum + (r.irating_after - r.irating_before), 0);
  const previousNetDelta = previousSameWeekRaces.length ? previousSameWeekRaces.reduce((sum, r) => sum + (r.irating_after - r.irating_before), 0) : null;

  paragraphs.push(`${label}, Week ${week}: ${weekRaces.length} corrida${weekRaces.length === 1 ? "" : "s"}, ${wins} vitória${wins === 1 ? "" : "s"}, iRating ${fmt1(netDelta)} na semana.`);

  if (previousNetDelta !== null) {
    const diff = netDelta - previousNetDelta;
    paragraphs.push(diff >= 0
      ? `Melhor que a mesma week da season anterior (${fmt1(previousNetDelta)} lá contra ${fmt1(netDelta)} agora).`
      : `Pior que a mesma week da season anterior (${fmt1(previousNetDelta)} lá contra ${fmt1(netDelta)} agora).`);
  }

  const bestRace = pickExtreme(weekRaces, "max");
  const worstRace = pickExtreme(weekRaces, "min");
  if (bestRace && worstRace && bestRace !== worstRace) {
    paragraphs.push(`Ponto alto da semana: ${bestRace.car} em ${bestRace.track} (${fmt1(bestRace.delta)}). Ponto baixo: ${worstRace.car} em ${worstRace.track} (${fmt1(worstRace.delta)}).`);
  } else if (bestRace) {
    paragraphs.push(`Única corrida da semana: ${bestRace.car} em ${bestRace.track} (${fmt1(bestRace.delta)}).`);
  }

  const withIncidents = weekRaces.filter((r) => r.incidents !== null);
  if (withIncidents.length) {
    const totalIncidents = withIncidents.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
    paragraphs.push(totalIncidents === 0
      ? `Semana limpa: 0 incidentes em ${withIncidents.length} corrida${withIncidents.length === 1 ? "" : "s"}.`
      : `${totalIncidents} incidente${totalIncidents === 1 ? "" : "s"} somados nas ${withIncidents.length} corrida${withIncidents.length === 1 ? "" : "s"} da semana.`);
  }

  return paragraphs;
}

export async function GET(request: NextRequest) {
  try {
    const scope = request.nextUrl.searchParams.get("scope") === "week" ? "week" : "season";

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (driverError) throwSupabaseError("drivers", driverError);
    if (!driver) throw new Error("Nenhum piloto encontrado no Supabase");

    const { data: seasons, error: seasonError } = await supabaseAdmin.from("v_season_summary").select("season_id,season_name");
    if (seasonError) throwSupabaseError("v_season_summary", seasonError);
    const orderedSeasons = [...(seasons ?? [])].sort((a, b) => Number(b.season_id) - Number(a.season_id));
    const currentSeason = orderedSeasons[0];
    const previousSeason = orderedSeasons[1];
    if (!currentSeason || !previousSeason) throw new Error("São necessárias pelo menos duas seasons para o relatório");
    const currentSeasonId = String(currentSeason.season_id);
    const previousSeasonId = String(previousSeason.season_id);

    const { data: calendarRows, error: calendarError } = await supabaseAdmin
      .from("v_season_calendar").select("season_id, season_name, season_start").in("season_id", [currentSeasonId, previousSeasonId]);
    if (calendarError) throwSupabaseError("v_season_calendar", calendarError);
    const calendarById = new Map((calendarRows ?? []).map((row) => [String(row.season_id), row]));
    const currentSeasonStart = calendarById.get(currentSeasonId)?.season_start;
    const previousSeasonStart = calendarById.get(previousSeasonId)?.season_start;
    if (!currentSeasonStart || !previousSeasonStart) throw new Error("v_season_calendar sem season_start para a season atual/anterior");
    const currentSeasonEnd = new Date(new Date(currentSeasonStart).getTime() + 84 * 86_400_000).toISOString();

    // Mesma janela (previousSeasonStart -> currentSeasonEnd) e mesma view reconstruída
    // (v_race_results_irating) que app/api/dashboard/overview/route.ts já usa -- tipicamente bem
    // abaixo dos 1000 registros do max_rows do PostgREST (a season atual sozinha já mostrou 104
    // corridas ao vivo), mas paginado do mesmo jeito por precaução depois do bug real encontrado
    // na feature de sequência (ver esse commit) -- nunca mais confiar num único .range() alto.
    const windowRaces: RaceRow[] = [];
    {
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error: pageError } = await supabaseAdmin
          .from("v_race_results_irating")
          .select("raced_at, category, series_name, track_name, car_name, season_week, finish_position, irating_after, irating_before, sof, incidents")
          .eq("driver_id", driver.id)
          .gte("raced_at", previousSeasonStart)
          .lt("raced_at", currentSeasonEnd)
          .in("category", CATEGORIES)
          .order("raced_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (pageError) throwSupabaseError("v_race_results_irating", pageError);
        windowRaces.push(...((page ?? []) as RaceRow[]));
        if (!page || page.length < pageSize) break;
      }
    }

    const currentSeasonStartMs = new Date(currentSeasonStart).getTime();
    const currentRacesAll = windowRaces.filter((r) => new Date(r.raced_at).getTime() >= currentSeasonStartMs);
    const previousRacesAll = windowRaces.filter((r) => new Date(r.raced_at).getTime() < currentSeasonStartMs);

    // Safety Rating: início da season (primeiro registro >= currentSeasonStart) vs. atual (mais
    // recente) -- rating_history é a única fonte de SR (iRStats não expõe), mesma dependência já
    // documentada no overview.
    const { data: srHistoryRows, error: srError } = await supabaseAdmin
      .from("rating_history")
      .select("category,rating,rating_display,recorded_at")
      .eq("driver_id", driver.id)
      .eq("rating_type", "safety_rating")
      .in("category", CATEGORIES)
      .gte("recorded_at", currentSeasonStart)
      .order("recorded_at", { ascending: true });
    if (srError) throwSupabaseError("rating_history", srError);
    const srRows = (srHistoryRows ?? []) as { category: Category; rating: number | null; rating_display: string | null; recorded_at: string }[];
    function srScore(row: { rating: number | null; rating_display: string | null }) {
      const displayed = row.rating_display?.match(/([0-9]+(?:\.[0-9]+)?)$/)?.[1];
      return displayed ? Number(displayed) : row.rating === null ? null : (row.rating % 1000) / 100;
    }
    function srBounds(category: Category) {
      const rows = srRows.filter((r) => r.category === category);
      if (!rows.length) return { start: null, current: null };
      return { start: srScore(rows[0]), current: srScore(rows[rows.length - 1]) };
    }

    if (scope === "season") {
      const sections = CATEGORIES.map((category) => {
        const currentRaces = currentRacesAll.filter((r) => r.category === category);
        const previousRaces = previousRacesAll.filter((r) => r.category === category);
        const currentIrating = currentRaces.length ? currentRaces[currentRaces.length - 1].irating_after : null;
        const seasonStartIrating = currentRaces.length ? currentRaces[0].irating_before : null;
        const { start: seasonStartSR, current: currentSR } = srBounds(category);

        // Streak (mesma lógica de app/api/dashboard/overview/route.ts, recalculada aqui a partir
        // da mesma janela de 2 seasons -- suficiente pro streak ATUAL; o recorde all-time
        // reportado aqui fica restrito a essas 2 seasons por simplicidade nesta rota separada,
        // então é rotulado como "recorde nas 2 seasons", não "all-time", pra não contradizer o
        // KPI da Overview (que busca a carreira inteira paginada).
        const categoryChrono = windowRaces.filter((r) => r.category === category);
        let streakCurrent = 0, streakBest = 0, running = 0;
        for (const row of categoryChrono) {
          if (row.irating_after - row.irating_before > 0) { running += 1; if (running > streakBest) streakBest = running; }
          else running = 0;
        }
        streakCurrent = running;

        return {
          category,
          paragraphs: buildCategorySeasonNarrative({
            category, currentRaces, previousRaces, currentIrating, seasonStartIrating, currentSR, seasonStartSR, streakCurrent, streakBest,
          }),
        };
      });

      return NextResponse.json({
        status: "ok",
        scope: "season",
        seasonName: currentSeason.season_name,
        previousSeasonName: previousSeason.season_name,
        generatedAt: new Date().toISOString(),
        sections,
      });
    }

    // scope === "week": pega, por carteira, a MAIOR season_week com corrida registrada na season
    // atual (a semana vigente ou a última com resultado, exatamente como pedido -- não precisa de
    // relógio/calendário, só olha pra onde os resultados já chegaram).
    const sections = CATEGORIES.map((category) => {
      const currentRaces = currentRacesAll.filter((r) => r.category === category && r.season_week !== null);
      const week = currentRaces.length ? Math.max(...currentRaces.map((r) => r.season_week as number)) : null;
      const weekRaces = week === null ? [] : currentRaces.filter((r) => r.season_week === week);
      const previousSameWeekRaces = week === null ? [] : previousRacesAll.filter((r) => r.category === category && r.season_week === week);
      return {
        category,
        week,
        paragraphs: buildCategoryWeekNarrative({ category, week, weekRaces, previousSameWeekRaces }),
      };
    });

    return NextResponse.json({
      status: "ok",
      scope: "week",
      seasonName: currentSeason.season_name,
      previousSeasonName: previousSeason.season_name,
      generatedAt: new Date().toISOString(),
      sections,
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
