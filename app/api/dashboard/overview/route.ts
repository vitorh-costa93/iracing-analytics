import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SeasonSummaryRow = {
  season_id: string | number;
  season_name: string;
  race_sessions: number | null;
  total_laps: number | null;
};

type CategorySummaryRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  corridas: number | null;
  delta_irating: number | null;
  delta_medio: number | null;
  mediana: number | null;
  pct_positivas: number | null;
};

type WeeklyRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  week_number: number;
  week_start: string;
  week_end: string;

  irating_before_week: number | null;
  irating_first: number | null;
  irating_end_of_week: number | null;
  weekly_delta: number | null;

  irating_min: number | null;
  irating_max: number | null;

  rating_changes: number | null;

  races: number | null;
  cars: string[] | null;
  tracks: string[] | null;
};

type HistoricalRow = {
  rating_category: "formula_car" | "sports_car";
  car_class: string | null;
  car: string;
  track: string;
  races: number | null;
  delta_irating: number | null;
  avg_delta_irating: number | null;
};

type RatingRow = {
  category: string;
  rating_type: string;
  rating: number | null;
  rating_display: string | null;
  recorded_at: string;
};

type SafetyHistoryRow = RatingRow;

type OfficialSeriesResultRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  series_name: string;
  starts: number;
  wins: number;
  source: string;
  captured_at: string;
};

type RaceCandidateRow = { session_id: number; rating_category: "formula_car" | "sports_car"; car: string; track: string; started_at: string; ended_at: string; delta_irating: number; candidate_for_race: number; race_for_rating: number };

function normalizeSeasonId(value: string | number) {
  return String(value);
}

function seasonNumber(value: string | number) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : -1;
}

function throwSupabaseError(
  source: string,
  error: unknown
): never {
  if (
    error &&
    typeof error === "object"
  ) {
    const obj = error as Record<
      string,
      unknown
    >;

    const message =
      typeof obj.message === "string"
        ? obj.message
        : JSON.stringify(obj);

    const code =
      typeof obj.code === "string"
        ? ` [${obj.code}]`
        : "";

    const details =
      typeof obj.details === "string" &&
      obj.details
        ? ` | ${obj.details}`
        : "";

    const hint =
      typeof obj.hint === "string" &&
      obj.hint
        ? ` | Hint: ${obj.hint}`
        : "";

    throw new Error(
      `${source}${code}: ${message}${details}${hint}`
    );
  }

  throw new Error(
    `${source}: ${String(error)}`
  );
}

export async function GET() {
  try {
    // =====================================================
    // PILOTO
    // =====================================================

    const {
      data: driver,
      error: driverError,
    } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, name, platform_driver_id, updated_at"
      )
      .order("updated_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (driverError) {
      throwSupabaseError(
        "drivers",
        driverError
      );
    }

    if (!driver) {
      throw new Error(
        "Nenhum piloto encontrado no Supabase"
      );
    }

    // =====================================================
    // CONSULTAS ANALÍTICAS
    // =====================================================

    const [
      seasonsResult,
      categoriesResult,
      weeklyResult,
      historicalResult,
      ratingsResult,
      safetyHistoryResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("v_season_summary")
        .select(
          `
          season_id,
          season_name,
          race_sessions,
          total_laps
          `
        ),

      supabaseAdmin
        .from(
          "v_season_category_summary"
        )
        .select(
          `
          season_id,
          season_name,
          rating_category,
          corridas,
          delta_irating,
          delta_medio,
          mediana,
          pct_positivas
          `
        ),

      supabaseAdmin
        .from(
          "v_season_weekly_irating"
        )
        .select(
          `
          season_id,
          season_name,
          rating_category,
          week_number,
          week_start,
          week_end,
          irating_before_week,
          irating_first,
          irating_end_of_week,
          weekly_delta,
          irating_min,
          irating_max,
          rating_changes,
          races,
          cars,
          tracks
          `
        )
        .order("week_number", {
          ascending: true,
        }),

      supabaseAdmin
        .from(
          "v_historical_performance"
        )
        .select(
          `
          rating_category,
          car_class,
          car,
          track,
          races,
          delta_irating,
          avg_delta_irating
          `
        ),

      supabaseAdmin
        .from("ratings")
        .select(
          `
          category,
          rating_type,
          rating,
          rating_display,
          recorded_at
          `
        )
        .eq(
          "driver_id",
          driver.id
        )
        .order("recorded_at", {
          ascending: false,
        }),

      supabaseAdmin
        .from("rating_history")
        .select("category,rating_type,rating,rating_display,recorded_at")
        .eq("driver_id", driver.id)
        .eq("rating_type", "safety_rating")
        .in("category", ["formula_car", "sports_car"])
        .order("recorded_at", { ascending: true }),
    ]);

    // =====================================================
    // ERROS — AGORA IDENTIFICAMOS A VIEW EXATA
    // =====================================================

    if (seasonsResult.error) {
      throwSupabaseError(
        "v_season_summary",
        seasonsResult.error
      );
    }

    if (categoriesResult.error) {
      throwSupabaseError(
        "v_season_category_summary",
        categoriesResult.error
      );
    }

    if (weeklyResult.error) {
      throwSupabaseError(
        "v_season_weekly_irating",
        weeklyResult.error
      );
    }

    if (historicalResult.error) {
      throwSupabaseError(
        "v_historical_performance",
        historicalResult.error
      );
    }

    if (ratingsResult.error) {
      throwSupabaseError(
        "ratings",
        ratingsResult.error
      );
    }
    if (safetyHistoryResult.error) throwSupabaseError("rating_history safety_rating", safetyHistoryResult.error);

    // =====================================================
    // DADOS
    // =====================================================

    const seasons =
      (seasonsResult.data ??
        []) as SeasonSummaryRow[];

    const categories =
      (categoriesResult.data ??
        []) as CategorySummaryRow[];

    const weekly =
      (weeklyResult.data ??
        []) as WeeklyRow[];

    const historical =
      (historicalResult.data ??
        []) as HistoricalRow[];

    const ratings =
      (ratingsResult.data ??
        []) as RatingRow[];
    const safetyHistory = (safetyHistoryResult.data ?? []) as SafetyHistoryRow[];

    // =====================================================
    // SEASONS
    // =====================================================

    const orderedSeasons = [
      ...seasons,
    ].sort(
      (a, b) =>
        seasonNumber(
          b.season_id
        ) -
        seasonNumber(
          a.season_id
        )
    );

    const currentSeason =
      orderedSeasons[0];

    const previousSeason =
      orderedSeasons[1];

    if (
      !currentSeason ||
      !previousSeason
    ) {
      throw new Error(
        "São necessárias pelo menos duas seasons para o comparativo"
      );
    }

    const currentSeasonId =
      normalizeSeasonId(
        currentSeason.season_id
      );

    const previousSeasonId =
      normalizeSeasonId(
        previousSeason.season_id
      );

    const officialResultsResult = await supabaseAdmin
      .from("official_series_results")
      .select("season_id,season_name,rating_category,series_name,starts,wins,source,captured_at")
      .eq("driver_id", driver.id)
      .in("season_id", [Number(currentSeasonId), Number(previousSeasonId)])
      .order("wins", { ascending: false });

    if (officialResultsResult.error) {
      throwSupabaseError("official_series_results", officialResultsResult.error);
    }

    const officialResults = (officialResultsResult.data ?? []) as OfficialSeriesResultRow[];

    const { data: currentRaceSessions, error: raceSessionsError } = await supabaseAdmin
      .from("driving_sessions")
      .select("id,garage61_event_id,car_id,track_id,started_at,ended_at")
      .eq("driver_id", driver.id).eq("season_id", currentSeasonId).eq("session_type", 3)
      .order("started_at", { ascending: false });
    if (raceSessionsError) throwSupabaseError("driving_sessions races", raceSessionsError);
    const sessionIds = (currentRaceSessions ?? []).map((row) => Number(row.id));
    const eventIds = (currentRaceSessions ?? []).map((row) => String(row.garage61_event_id));
    const [{ data: raceCandidates, error: candidateError }, { data: raceLaps, error: raceLapsError }, { data: carRows }, { data: trackRows }] = await Promise.all([
      sessionIds.length ? supabaseAdmin.from("v_race_irating_candidates").select("session_id,rating_category,car,track,started_at,ended_at,delta_irating,candidate_for_race,race_for_rating").in("session_id", sessionIds).eq("candidate_for_race", 1).eq("race_for_rating", 1) : Promise.resolve({ data: [], error: null }),
      eventIds.length ? supabaseAdmin.from("laps").select("lap_time,clean,incomplete,garage61_payload").eq("driver_id", driver.id).in("garage61_payload->>event", eventIds).limit(10000) : Promise.resolve({ data: [], error: null }),
      supabaseAdmin.from("cars").select("id,name"),
      supabaseAdmin.from("tracks").select("id,name"),
    ]);
    if (candidateError) throwSupabaseError("v_race_irating_candidates current", candidateError);
    if (raceLapsError) throwSupabaseError("laps current races", raceLapsError);
    const candidatesBySession = new Map(((raceCandidates ?? []) as RaceCandidateRow[]).map((row) => [Number(row.session_id), row]));
    const carsById = new Map((carRows ?? []).map((row) => [Number(row.id), row.name]));
    const tracksById = new Map((trackRows ?? []).map((row) => [Number(row.id), row.name]));
    const lapsByEvent = new Map<string, number[]>();
    for (const lap of raceLaps ?? []) {
      const payload = lap.garage61_payload as { event?: string; sessionType?: number } | null;
      if (!payload?.event || payload.sessionType !== 3 || lap.incomplete || !Number.isFinite(Number(lap.lap_time)) || Number(lap.lap_time) <= 0) continue;
      lapsByEvent.set(payload.event, [...(lapsByEvent.get(payload.event) ?? []), Number(lap.lap_time)]);
    }
    const races = (currentRaceSessions ?? []).map((session) => {
      const candidate = candidatesBySession.get(Number(session.id));
      const started = new Date(session.started_at).getTime(), ended = new Date(session.ended_at).getTime();
      const lapTimes = lapsByEvent.get(session.garage61_event_id) ?? [];
      return {
        id: Number(session.id), startedAt: session.started_at, endedAt: session.ended_at,
        durationMinutes: Math.max(0, (ended - started) / 60000), delta: candidate?.delta_irating ?? null,
        ratingCategory: candidate?.rating_category ?? null, series: null,
        car: candidate?.car ?? carsById.get(Number(session.car_id)) ?? `Carro ${session.car_id}`,
        track: candidate?.track ?? tracksById.get(Number(session.track_id)) ?? `Pista ${session.track_id}`,
        bestLap: lapTimes.length ? Math.min(...lapTimes) : null, startPosition: null, finishPosition: null,
      };
    });

    function winsFor(seasonId: string, category: "formula_car" | "sports_car") {
      return officialResults
        .filter((row) => normalizeSeasonId(row.season_id) === seasonId && row.rating_category === category)
        .reduce((total, row) => total + row.wins, 0);
    }

    const resultBreakdown = officialResults.map((row) => ({
      seasonId: normalizeSeasonId(row.season_id),
      seasonName: row.season_name,
      category: row.rating_category,
      series: row.series_name,
      starts: row.starts,
      wins: row.wins,
      source: row.source,
      capturedAt: row.captured_at,
    }));

    // =====================================================
    // IRATING ATUAL
    // =====================================================

    const latestRatings: Record<
      "formula_car" | "sports_car",
      number | null
    > = {
      formula_car: null,
      sports_car: null,
    };

    for (const row of ratings) {
      if (row.rating_type !== "irating") continue;
      if (
        row.category !==
          "formula_car" &&
        row.category !==
          "sports_car"
      ) {
        continue;
      }

      if (
        latestRatings[
          row.category
        ] === null
      ) {
        latestRatings[
          row.category
        ] = row.rating;
      }
    }

    const safetyScore = (row: RatingRow) => {
      const displayed = row.rating_display?.match(/([0-9]+(?:\.[0-9]+)?)$/)?.[1];
      return displayed ? Number(displayed) : row.rating === null ? null : row.rating % 1000 / 100;
    };
    const latestSafety = { formula_car: null, sports_car: null } as Record<"formula_car" | "sports_car", number | null>;
    const latestSafetyDisplay = { formula_car: null, sports_car: null } as Record<"formula_car" | "sports_car", string | null>;
    for (const row of ratings) {
      if (row.rating_type !== "safety_rating" || (row.category !== "formula_car" && row.category !== "sports_car")) continue;
      if (latestSafety[row.category] === null) {
        latestSafety[row.category] = safetyScore(row);
        latestSafetyDisplay[row.category] = row.rating_display;
      }
    }

    function safetyAt(category: "formula_car" | "sports_car", at: string) {
      const cutoff = new Date(at).getTime();
      const candidates = safetyHistory.filter((row) => row.category === category && new Date(row.recorded_at).getTime() <= cutoff);
      return candidates.length ? safetyScore(candidates[candidates.length - 1]) : null;
    }

    function safetyWeeklyFor(seasonId: string, category: "formula_car" | "sports_car") {
      return weeklyFor(seasonId, category).map((point) => ({
        ...point,
        safetyRatingEnd: safetyAt(category, point.weekEnd),
      }));
    }

    const elapsedWeek = Math.max(1, Math.min(12, weeklyFor(currentSeasonId, "formula_car").findLast((point) => new Date(point.weekStart) <= new Date())?.week ?? 1));
    function iratingAtSameWeek(category: "formula_car" | "sports_car") {
      return weeklyFor(previousSeasonId, category).find((point) => point.week === elapsedWeek)?.iratingEnd ?? null;
    }

    // =====================================================
    // KPI POR CATEGORIA
    // =====================================================

    function categoryMetric(
      seasonId: string,
      category:
        | "formula_car"
        | "sports_car"
    ) {
      const row =
        categories.find(
          (item) =>
            normalizeSeasonId(
              item.season_id
            ) === seasonId &&
            item.rating_category ===
              category
        );

      return {
        delta:
          row?.delta_irating ??
          0,

        races:
          row?.corridas ?? 0,

        avgDelta:
          row?.delta_medio ??
          null,

        medianDelta:
          row?.mediana ??
          null,

        positivePct:
          row?.pct_positivas ??
          null,
      };
    }

    // =====================================================
    // DADOS SEMANAIS
    // =====================================================

    function weeklyFor(
      seasonId: string,
      category:
        | "formula_car"
        | "sports_car"
    ) {
      return weekly
        .filter(
          (row) =>
            normalizeSeasonId(
              row.season_id
            ) === seasonId &&
            row.rating_category ===
              category
        )
        .sort(
          (a, b) =>
            a.week_number -
            b.week_number
        )
        .map((row) => ({
          week:
            row.week_number,

          weekStart:
            row.week_start,

          weekEnd:
            row.week_end,

          iratingBeforeWeek:
            row.irating_before_week,

          iratingFirst:
            row.irating_first,

          iratingEnd:
            row.irating_end_of_week,

          delta:
            row.weekly_delta,

          min:
            row.irating_min,

          max:
            row.irating_max,

          ratingChanges:
            row.rating_changes ??
            0,

          races:
            row.races ?? 0,

          cars:
            row.cars ?? [],

          tracks:
            row.tracks ?? [],
        }));
    }

    // =====================================================
    // FOCUS — síntese acionável: pior contexto por corrida (já calculado acima em `historical`)
    // + o ponto de melhoria mais recente de cada Debrief em cache, para virar uma recomendação
    // direta em vez de só um dashboard passivo que o piloto precisa interpretar sozinho.
    // =====================================================
    const trackAgg = new Map<string, { races: number; delta: number }>();
    for (const row of historical) {
      const key = row.track;
      const current = trackAgg.get(key) ?? { races: 0, delta: 0 };
      current.races += row.races ?? 0;
      current.delta += row.delta_irating ?? 0;
      trackAgg.set(key, current);
    }
    const worstTrack = [...trackAgg.entries()]
      .filter(([, value]) => value.races >= 2)
      .map(([track, value]) => ({ track, races: value.races, avg: value.delta / value.races }))
      .sort((a, b) => a.avg - b.avg)[0] ?? null;

    const { data: debriefRows } = await supabaseAdmin.from("race_debriefs").select("rating_category,payload").eq("driver_id", driver.id);
    const categoryLabel = (value: string) => value === "formula_car" ? "Formula Car" : value === "gtp_car" ? "GTP" : "Sports Car";

    const focus: { title: string; detail: string }[] = [];
    if (worstTrack && worstTrack.avg < 0) {
      focus.push({
        title: `Pior contexto por corrida: ${worstTrack.track}`,
        detail: `Média de ${worstTrack.avg.toFixed(1)} iRating por corrida em ${worstTrack.races} corridas — o pior número entre todas as pistas com pelo menos 2 corridas registradas.`,
      });
    }
    for (const row of debriefRows ?? []) {
      const payload = row.payload as { improvements?: string[] } | null;
      const improvement = payload?.improvements?.[0];
      if (improvement) focus.push({ title: `${categoryLabel(row.rating_category as string)}: ponto de melhoria do último Debrief`, detail: improvement });
    }

    // =====================================================
    // PRACTICE INSIGHT — daily_statistics (sincronizado, nunca consultado antes) cruzado com o
    // resultado real da corrida daquele mesmo dia/carro/pista, pra ver se corridas com pouco treino
    // no mesmo dia realmente saem piores, em vez de assumir isso sem checar os números.
    // =====================================================
    let practiceInsight: { title: string; detail: string } | null = null;
    try {
      const [{ data: dailyRows }, { data: raceMatchRows }, { data: raceSessionRows }] = await Promise.all([
        supabaseAdmin.from("daily_statistics").select("statistic_date,car_id,track_id,session_type,laps_driven").eq("driver_id", driver.id).in("session_type", [1, 2]),
        supabaseAdmin.from("race_rating_matches").select("session_id,delta_irating").eq("driver_id", driver.id),
        supabaseAdmin.from("driving_sessions").select("id,car_id,track_id,started_at").eq("driver_id", driver.id).eq("session_type", 3),
      ]);
      const practiceByKey = new Map<string, number>();
      for (const row of dailyRows ?? []) {
        const key = `${row.statistic_date}|${row.car_id}|${row.track_id}`;
        practiceByKey.set(key, (practiceByKey.get(key) ?? 0) + (row.laps_driven ?? 0));
      }
      const sessionById = new Map((raceSessionRows ?? []).map((row) => [Number(row.id), row]));
      const pairs = (raceMatchRows ?? []).map((match) => {
        const session = sessionById.get(Number(match.session_id));
        if (!session) return null;
        const date = new Date(session.started_at).toISOString().slice(0, 10);
        const key = `${date}|${session.car_id}|${session.track_id}`;
        const practiceLaps = practiceByKey.get(key) ?? 0;
        return { practiceLaps, delta: match.delta_irating };
      }).filter((item): item is { practiceLaps: number; delta: number } => item !== null);

      if (pairs.length >= 20) {
        const sortedLaps = [...pairs.map((p) => p.practiceLaps)].sort((a, b) => a - b);
        const median = sortedLaps[Math.floor(sortedLaps.length / 2)];
        const below = pairs.filter((p) => p.practiceLaps <= median);
        const above = pairs.filter((p) => p.practiceLaps > median);
        if (below.length >= 8 && above.length >= 8) {
          const avg = (list: typeof pairs) => list.reduce((sum, p) => sum + p.delta, 0) / list.length;
          const belowAvg = avg(below), aboveAvg = avg(above);
          const gap = aboveAvg - belowAvg;
          if (Math.abs(gap) >= 3) {
            practiceInsight = {
              title: gap > 0 ? "Mais treino no mesmo dia correlaciona com resultado melhor" : "Mais treino no mesmo dia não mostrou correlação positiva com o resultado",
              detail: gap > 0
                ? `Corridas com até ${median} voltas de treino no mesmo dia (mesmo carro/pista) tiveram média de ${belowAvg.toFixed(1)} iRating; com mais que isso, ${aboveAvg.toFixed(1)} — uma diferença de ${gap.toFixed(1)} pontos. É correlação, não causa comprovada, mas é consistente com "aquecer" antes de correr.`
                : `Corridas com mais treino no mesmo dia não saíram melhores nos seus números (${belowAvg.toFixed(1)} com até ${median} voltas de treino vs ${aboveAvg.toFixed(1)} com mais) — pelo menos nessa amostra, a quantidade de treino no dia não parece ser o fator decisivo pra você.`,
            };
          }
        }
      }
    } catch {
      practiceInsight = null;
    }

    // =====================================================
    // RESPONSE
    // =====================================================

    return NextResponse.json({
      status: "ok",

      driver: {
        id:
          driver.id,

        name:
          driver.name,

        iracingId:
          driver.platform_driver_id,
      },

      season: {
        current: {
          id:
            currentSeasonId,

          name:
            currentSeason.season_name,

          races:
            currentSeason.race_sessions ??
            0,

          laps:
            currentSeason.total_laps ??
            0,
        },

        previous: {
          id:
            previousSeasonId,

          name:
            previousSeason.season_name,

          races:
            previousSeason.race_sessions ??
            0,

          laps:
            previousSeason.total_laps ??
            0,
        },
      },

      ratings:
        latestRatings,

      safetyRatings: latestSafety,

      kpis: {
        formula: {
          irating: { current: latestRatings.formula_car, previousSameWeek: iratingAtSameWeek("formula_car"), week: elapsedWeek },
          current:
            categoryMetric(
              currentSeasonId,
              "formula_car"
            ),

          previous:
            categoryMetric(
              previousSeasonId,
              "formula_car"
            ),

          wins: {
            current: winsFor(currentSeasonId, "formula_car"),
            previous: winsFor(previousSeasonId, "formula_car"),
          },
          safetyRating: {
            current: latestSafety.formula_car,
            currentDisplay: latestSafetyDisplay.formula_car,
            previous: safetyAt("formula_car", weeklyFor(previousSeasonId, "formula_car").at(-1)?.weekEnd ?? new Date(0).toISOString()),
          },
        },

        sports: {
          irating: { current: latestRatings.sports_car, previousSameWeek: iratingAtSameWeek("sports_car"), week: elapsedWeek },
          current:
            categoryMetric(
              currentSeasonId,
              "sports_car"
            ),

          previous:
            categoryMetric(
              previousSeasonId,
              "sports_car"
            ),

          wins: {
            current: winsFor(currentSeasonId, "sports_car"),
            previous: winsFor(previousSeasonId, "sports_car"),
          },
          safetyRating: {
            current: latestSafety.sports_car,
            currentDisplay: latestSafetyDisplay.sports_car,
            previous: safetyAt("sports_car", weeklyFor(previousSeasonId, "sports_car").at(-1)?.weekEnd ?? new Date(0).toISOString()),
          },
        },
      },

      weekly: {
        formula: {
          current:
            safetyWeeklyFor(
              currentSeasonId,
              "formula_car"
            ),

          previous:
            safetyWeeklyFor(
              previousSeasonId,
              "formula_car"
            ),
        },

        sports: {
          current:
            safetyWeeklyFor(
              currentSeasonId,
              "sports_car"
            ),

          previous:
            safetyWeeklyFor(
              previousSeasonId,
              "sports_car"
            ),
        },
      },

      historical:
        historical.map(
          (row) => ({
            ratingCategory:
              row.rating_category,

            carClass:
              row.car_class,

            car:
              row.car,

            track:
              row.track,

            races:
              row.races ??
              0,

            delta:
              row.delta_irating ??
              0,

            avgDelta:
              row.avg_delta_irating ??
              0,
          })
        ),

      races,

      officialResults: {
        lastCapturedAt: resultBreakdown.reduce<string | null>((latest, row) =>
          !latest || row.capturedAt > latest ? row.capturedAt : latest, null),
        series: resultBreakdown,
      },

      focus,
      practiceInsight,

      featureAvailability: {
        wins: true,

        winsReason:
          "Resultados oficiais persistidos por temporada; atualização automática aguardando OAuth do iRacing.",
      },
    });
  } catch (error) {
    console.error(
      "Dashboard overview error:",
      error
    );

    let message =
      "Erro desconhecido no dashboard";

    if (
      error instanceof Error
    ) {
      message =
        error.message;
    } else if (
      error &&
      typeof error === "object"
    ) {
      const obj =
        error as Record<
          string,
          unknown
        >;

      if (
        typeof obj.message ===
        "string"
      ) {
        message =
          obj.message;
      } else {
        try {
          message =
            JSON.stringify(
              error
            );
        } catch {
          message =
            String(error);
        }
      }
    } else {
      message =
        String(error);
    }

    return NextResponse.json(
      {
        status: "error",
        message,
      },
      {
        status: 500,
      }
    );
  }
}
