"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "./night-grid-overview.css";
import Link from "next/link";
import SeasonCalendarImportModal from "@/components/SeasonCalendarImportModal";
import { CategoryHeading, KpiCard, Panel, PageTitle, SegmentedControl, SelectPill } from "@/components/ui";
import type { KpiCategory, KpiTone } from "@/components/ui";
import RaceScatter from "@/components/overview/RaceScatter";
import LatestRaces from "@/components/overview/LatestRaces";
import { type WinnerGapItem, DeltaByContext, GapToWinner, gapOverall } from "@/components/overview/PerformancePanels";
import { useIsMobile } from "@/lib/use-is-mobile";
import { signedNumber } from "@/components/overview/format";
import { trackUiEvent } from "@/lib/track-ui-event";
import { weekLabel, weekShort } from "@/lib/season-week";
import { DATA_SYNC_DONE_EVENT, DATA_SYNC_PROGRESS_EVENT, type DataSyncDetail } from "@/lib/data-sync-action";

type Category = "formula" | "sports";
type RankingMode = "car" | "track";

type WeekPoint = {
  week: number;
  weekStart: string;
  weekEnd: string;
  iratingBeforeWeek: number | null;
  iratingFirst: number | null;
  iratingEnd: number | null;
  safetyRatingEnd?: number | null;
  delta: number | null;
  min: number | null;
  max: number | null;
  ratingChanges: number;
  races: number;
  cars: string[];
  tracks: string[];
};

type HistoricalRow = {
  ratingCategory: "formula_car" | "sports_car" | "road";
  carClass: string | null;
  car: string;
  track: string;
  races: number;
  delta: number;
  avgDelta: number;
};

type ScheduledWeekContext = {
  kind: "sf23" | "imsa" | "gt3";
  series: string;
  track: string;
  trackMatchTerms: string[];
};

type DashboardData = {
  status: string;
  driver: { id: string; name: string; iracingId: string };
  season: {
    current: { id: string; name: string; races: number; laps: number };
    previous: { id: string; name: string; races: number; laps: number };
  };
  ratings: { formula_car: number | null; sports_car: number | null };
  safetyRatings: { formula_car: number | null; sports_car: number | null };
  kpis: {
    formula: {
      irating: { current: number | null; previousSameWeek: number | null; week: number };
      current: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      previous: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      wins: { current: number | null; previous: number | null };
      safetyRating: { current: number | null; currentDisplay: string | null; previous: number | null };
    };
    sports: {
      irating: { current: number | null; previousSameWeek: number | null; week: number };
      current: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      previous: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      wins: { current: number | null; previous: number | null };
      safetyRating: { current: number | null; currentDisplay: string | null; previous: number | null };
    };
  };
  weekly: {
    formula: { current: WeekPoint[]; previous: WeekPoint[] };
    sports: { current: WeekPoint[]; previous: WeekPoint[] };
  };
  historical: HistoricalRow[];
  weeklyContexts: ScheduledWeekContext[];
  featureAvailability: { wins: boolean; winsReason: string };
  races: Array<{ id: number; startedAt: string; endedAt: string; durationMinutes: number | null; delta: number | null; ratingCategory: "formula_car" | "sports_car" | null; series: string | null; car: string; track: string; seasonWeek?: number | null; bestLap: string | null; startPosition: number | null; finishPosition: number | null }>;
  streaks: {
    formula_car: { current: number; best: number };
    sports_car: { current: number; best: number };
  };
  winnerGapByTrack?: WinnerGapItem[];
  winnerGapBySegment?: { sf: WinnerGapItem[]; gt3: WinnerGapItem[]; imsa: WinnerGapItem[] };
};

type RankingItem = { label: string; delta: number; races: number; group?: string | null; avgDelta: number };

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function scheduledContextMatches(context: ScheduledWeekContext, row: HistoricalRow) {
  const historicalTrack = normalizedText(row.track);
  if (!context.trackMatchTerms.some((term) => {
    const normalizedTerm = normalizedText(term);
    return normalizedTerm.length >= 3 && (historicalTrack.includes(normalizedTerm) || normalizedTerm.includes(historicalTrack));
  })) return false;
  if (context.kind === "sf23") return /super formula/i.test(row.car);
  if (context.kind === "imsa") return row.carClass === "GTP" || row.carClass === "LMP2";
  return row.carClass === "GT3";
}

function shortSeason(name: string) {
  return name.replace(" Season ", " S");
}

// 31/08/2026: "você criou dois cards para essa semana no iRacing, não é necessário, é um card só por
// série e por pista -- não precisa separar em fixed e open" -- the auto-derived weekly-context
// fallback below keys each card by its raw series NAME, and Garage61/iRStats report "X - Fixed" and
// plain "X" as two different series strings for what the driver considers one and the same context
// (same car, same track, just a different setup-lock rule). Stripping that suffix before the dedup
// key collapses them into one card, same as the hand-curated WEEKLY_CONTEXTS entries already do
// implicitly (their `series` label is just written once, with no Fixed/Open distinction at all).
function stripFixedSuffix(series: string) {
  return series.replace(/\s*[-–—]?\s*\(?fixed\)?\s*$/i, "").trim();
}

function aggregateRows(
  rows: HistoricalRow[],
  key: "car" | "track",
  includeGroup = false
): RankingItem[] {
  const map = new Map<string, RankingItem>();

  for (const row of rows) {
    const label = row[key];
    const group = includeGroup ? row.carClass : null;
    const mapKey = `${group ?? ""}::${label}`;
    const current = map.get(mapKey) ?? { label, delta: 0, races: 0, group, avgDelta: 0 };
    current.delta += row.delta;
    current.races += row.races;
    map.set(mapKey, current);
  }

  // avgDelta must be recomputed as total/races AFTER aggregation, not summed/averaged from the
  // per-row avgDelta values; otherwise a track raced under several different cars would get its
  // average double-counted. It is the primary performance signal in the ranking.
  for (const item of map.values()) item.avgDelta = item.races > 0 ? item.delta / item.races : 0;

  // One isolated result is not a performance signal. Keep it in the race table, but do not turn
  // it into a "best/worst context" conclusion.
  return [...map.values()].filter((item) => item.races >= 2).sort((a, b) => b.avgDelta - a.avgDelta);
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState<Category>("sports");
  // Celular (etapa 7, Mobile.dc.html): mostra uma categoria de KPIs por vez; no desktop as duas aparecem.
  const [mobileFilter, setMobileFilter] = useState<"all" | Category>("sports");
  const isMobile = useIsMobile();
  // No celular o filtro do topo vale para a página inteira (KPIs, gráfico, performance, corridas e contextos).
  const pageFilter: "all" | Category = isMobile ? mobileFilter : "all";
  const [perfTab, setPerfTab] = useState<"sf" | "gt3" | "imsa">("gt3");
  // Options depend on which series this driver actually raced in that category this season, not a
  // hardcoded taxonomy — the real list (GT3 Challenge Fixed, IMSA, GT Sprint, Prototype, LMP2...)
  // is messier than "GT3/IMSA x Open/Fixed" and a fixed set would silently exclude series outside it.
  const [chartSeries, setChartSeries] = useState<string>("all");
  const [gt3Mode, setGt3Mode] = useState<RankingMode>("track");
  const [imsaMode, setImsaMode] = useState<RankingMode>("track");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [imsaClass, setImsaClass] = useState<"all" | "GTP" | "LMP2">("all");

  const loadDashboard = useCallback(async (force = false) => {
    const cacheKey = "iracing-dashboard-overview-v1";
    if (!force) {
      try {
        const cached = window.localStorage.getItem(cacheKey);
        if (cached) {
          setData(JSON.parse(cached) as DashboardData);
          setLoading(false);
        }
      } catch {}
    }
    try {
      const response = await fetch("/api/dashboard/overview" + (force ? "?refresh=1" : ""), { cache: force ? "no-store" : "default" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao carregar dashboard");
      setData(result);
      try { window.localStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    function onImportComplete(event: MessageEvent) {
      if (event.origin !== "https://irstats.com" && event.origin !== "https://garage61.net" && event.origin !== window.location.origin) return;
      const payload = event.data as { source?: string; message?: string };
      if (payload?.source !== "iracing-analytics-import") return;
      setMessage(payload.message ?? "Importação concluída.");
      void loadDashboard(true);
    }
    window.addEventListener("message", onImportComplete);
    return () => window.removeEventListener("message", onImportComplete);
  }, [loadDashboard]);

  // "Atualizar dados" (25/09/2026, redesign etapa 1): o botão mudou para o cabeçalho global
  // (components/AppHeader.tsx) e a sequência de passos foi extraída sem mudanças para
  // lib/data-sync-action.ts. Esta tela só acompanha o progresso pelos eventos e recarrega o
  // dashboard no fim, como antes.
  useEffect(() => {
    function onProgress(event: Event) {
      setMessage((event as CustomEvent<DataSyncDetail>).detail.message);
    }
    function onDone(event: Event) {
      setMessage((event as CustomEvent<DataSyncDetail>).detail.message);
      void loadDashboard(true);
    }
    window.addEventListener(DATA_SYNC_PROGRESS_EVENT, onProgress);
    window.addEventListener(DATA_SYNC_DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(DATA_SYNC_PROGRESS_EVENT, onProgress);
      window.removeEventListener(DATA_SYNC_DONE_EVENT, onDone);
    };
  }, [loadDashboard]);

  const rankings = useMemo(() => {
    if (!data) return null;

    const trackRows = data.historical.filter((row) => /super formula/i.test(row.car));
    const gt3Rows = data.historical.filter((row) => row.carClass === "GT3");
    const imsaRows = data.historical.filter((row) => (row.carClass === "GTP" || row.carClass === "LMP2") && (imsaMode !== "track" || imsaClass === "all" || row.carClass === imsaClass));

    return {
      tracks: aggregateRows(trackRows, "track"),
      gt3: aggregateRows(gt3Rows, gt3Mode, false),
      imsa: aggregateRows(imsaRows, imsaMode, true),
    };
  }, [data, gt3Mode, imsaMode, imsaClass]);

  if (loading) {
    return <div className="ng-page"><main className="ng-main"><div className="ngo-empty">Carregando Racing Analytics...</div></main></div>;
  }

  if (!data || !rankings) {
    return <div className="ng-page"><main className="ng-main"><div className="ngo-empty">{message ?? "Não foi possível carregar os dados."} <button type="button" className="ng-button" onClick={() => loadDashboard()}>Tentar novamente</button></div></main></div>;
  }

  const previousLabel = shortSeason(data.season.previous.name);
  const activeChartCategory: Category = pageFilter === "all" ? chartCategory : pageFilter;
  const categoryRaces = data.races.filter((race) => race.ratingCategory === (activeChartCategory === "formula" ? "formula_car" : "sports_car") && race.delta !== null);
  const racesShown = pageFilter === "all" ? data.races : data.races.filter((race) => race.ratingCategory === (pageFilter === "formula" ? "formula_car" : "sports_car"));
  // Sorted by how many races each series has this season — the driver's most-raced series leads
  // the dropdown instead of alphabetical order burying it.
  const seriesOptions = Array.from(categoryRaces.reduce((counts, race) => {
    const key = race.series ?? "Sem série";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]);
  const scatter = categoryRaces.filter((race) => chartSeries === "all" || (race.series ?? "Sem série") === chartSeries).map((race) => ({ id: race.id, durationMinutes: race.durationMinutes, delta: race.delta!, car: race.car, track: race.track, startedAt: race.startedAt }));
  // Cached Overview payloads from before the calendar importer did not contain this field. Keep
  // their existing race-derived fallback alive until the fresh request replaces localStorage.
  const scheduledContexts = data.weeklyContexts ?? [];
  // 03/09/2026: "aqui tá a IMSA, mas eu tenho certeza que fiz mais corridas lá, qual é o contexto
  // que tá sendo considerado?" -- the auto-derived fallback below used to match track + EXACT car,
  // so "Le Mans" for this week's Ferrari 499P only counted the 5 races run in that specific car,
  // hiding the 51 other Le Mans races run in different GTP/GT3/LMP2 cars. The official weekly
  // calendar matches by track + carClass for exactly this reason -- mirror that in the fallback
  // instead of falling back to an exact-car match, so an auto-derived
  // card gets the same broader "same class, same track" sample the curated ones do. Only falls
  // back to exact-car matching when the car has no known class (e.g. Formula cars aren't grouped
  // into car_groups), where mixing by a null "class" would wrongly lump unrelated cars together.
  const carClassByCar = new Map<string, string | null>();
  for (const row of data.historical) {
    if (!carClassByCar.has(row.car)) carClassByCar.set(row.car, row.carClass);
  }
  const weeklyContexts = (scheduledContexts.length
    ? scheduledContexts.map((context) => ({
      series: context.series,
      track: context.track,
      matches: (row: HistoricalRow) => scheduledContextMatches(context, row),
    }))
    : data.races.filter((race) => race.seasonWeek === data.kpis.formula.irating.week).map((race) => {
    const carClass = carClassByCar.get(race.car) ?? null;
    return {
      series: stripFixedSuffix(race.series ?? race.car),
      track: race.track,
      matches: (row: HistoricalRow) => row.track === race.track && (carClass ? row.carClass === carClass : row.car === race.car),
    };
  })).reduce<Array<{ key: string; series: string; track: string; avg: number | null; races: number; isFormula: boolean }>>((items, context) => {
    const key = `${context.series}::${context.track}`;
    if (items.some((item) => item.key === key)) return items;
    const contextRows = data.historical.filter(context.matches);
    const isFormula = contextRows.length > 0 ? contextRows.every((row) => /super formula/i.test(row.car)) : /super formula|formula/i.test(context.series);
    const races = contextRows.reduce((sum, row) => sum + row.races, 0);
    const avg = races >= 2 ? contextRows.reduce((sum, row) => sum + row.delta, 0) / races : null;
    items.push({ key, series: context.series, track: context.track, avg, races, isFormula });
    return items;
  }, []).filter((item) => pageFilter === "all" || (pageFilter === "formula") === item.isFormula).slice(0, 3);

  // ---- Night Grid: dados dos KPIs (mesmas fontes de antes: data.kpis, data.streaks, data.weekly, data.races)
  const prevShort = previousLabel.replace(/^\d{4}\s*/, "");
  const currentRaceRows = (category: "formula_car" | "sports_car") => data.races.filter((race) => race.ratingCategory === category);
  const weekSeries = (points: WeekPoint[]) => points.map((point) => point.iratingEnd ?? point.iratingFirst ?? point.iratingBeforeWeek);
  const kpiGroups = (["formula", "sports"] as const).map((key) => {
    const kpi = data.kpis[key];
    const category = key === "formula" ? "formula_car" : "sports_car";
    const streak = data.streaks[category];
    const rows = currentRaceRows(category).slice().reverse(); // cronológico
    const weeklyCat = data.weekly[key];
    const current = weekSeries(weeklyCat.current);
    const previous = weekSeries(weeklyCat.previous);
    const iratingDiff = kpi.irating.current !== null && kpi.irating.previousSameWeek !== null ? kpi.irating.current - kpi.irating.previousSameWeek : null;
    const winsDiff = kpi.wins.current !== null && kpi.wins.previous !== null ? kpi.wins.current - kpi.wins.previous : null;
    let cumulative = 0;
    const winSteps = rows.map((race) => (race.finishPosition === 1 ? ++cumulative : cumulative));
    const toneOf = (diff: number | null): KpiTone => (diff === null || diff === 0 ? "neutral" : diff > 0 ? "gain" : "loss");
    const arrow = (diff: number) => (diff > 0 ? "↗" : diff < 0 ? "↘" : "→");
    return {
      key,
      category: key as KpiCategory,
      name: key === "formula" ? "Formula Car" : "Sports Car",
      cards: [
        <KpiCard key="ir" category={key} label="iRating"
          value={kpi.irating.current === null ? "—" : kpi.irating.current.toLocaleString("pt-BR")}
          badge={kpi.safetyRating.currentDisplay ?? undefined}
          trend={iratingDiff === null ? "Sem comparação anterior" : `${arrow(iratingDiff)} ${signedNumber(iratingDiff)} vs. ${prevShort} ${weekShort(kpi.irating.week)}`}
          trendTone={toneOf(iratingDiff)}
          sparkline={current.some((v) => v !== null) ? { kind: "lines", current, previous: previous.some((v) => v !== null) ? previous : undefined, count: Math.max(current.length, previous.length) } : undefined}
          description={`Tracejado: ${prevShort}`} />,
        /* Só aparece no celular (Mobile.dc.html tem Safety Rating como cartão próprio); no desktop o selo do iRating cobre. */
        <div key="sr" className="ngo-kpi-sr-wrap"><KpiCard category={key} label="Safety Rating" value={kpi.safetyRating.currentDisplay ?? "—"} /></div>,
        <KpiCard key="w" category={key} label="Vitórias"
          value={kpi.wins.current === null ? "—" : kpi.wins.current.toLocaleString("pt-BR")}
          trend={winsDiff === null ? "Sem comparação anterior" : `${arrow(winsDiff)} ${signedNumber(winsDiff)} vs. ${prevShort}`}
          trendTone={toneOf(winsDiff)}
          sparkline={winSteps.length ? { kind: "steps", values: winSteps } : undefined}
          description={`Vitórias registradas · ${prevShort}: ${kpi.wins.previous?.toLocaleString("pt-BR") ?? "—"}`} />,
        /* 05/09/2026: sequência atual + recorde all-time (carreira inteira via iRStats). */
        <KpiCard key="s" category={key} label="Sequência"
          value={streak.current}
          trend={streak.current > 0 ? `${streak.current} corrida${streak.current === 1 ? "" : "s"} seguida${streak.current === 1 ? "" : "s"} ganhando iRating` : "Última corrida perdeu iRating"}
          trendTone={streak.current > 0 ? "gain" : "neutral"}
          sparkline={rows.length ? { kind: "bars", values: rows.slice(-12).map((race) => race.delta ?? 0) } : undefined}
          description={`Recorde all-time · ${streak.best} seguida${streak.best === 1 ? "" : "s"}`} />,
      ],
    };
  });

  const perfTabsAvailable: Array<"sf" | "gt3" | "imsa"> = pageFilter === "formula" ? ["sf"] : pageFilter === "sports" ? ["gt3", "imsa"] : ["sf", "gt3", "imsa"];
  const activePerfTab = perfTabsAvailable.includes(perfTab) ? perfTab : perfTabsAvailable[0];
  const perfMode = activePerfTab === "gt3" ? gt3Mode : activePerfTab === "imsa" ? imsaMode : "track";
  const perfItems = activePerfTab === "sf" ? rankings.tracks : activePerfTab === "gt3" ? rankings.gt3 : rankings.imsa;
  const perfLabel = activePerfTab === "sf" ? "SUPER FORMULA 23" : activePerfTab === "gt3" ? "GT3" : "IMSA GTP / LMP2";
  const perfTabOptions = ([{ value: "sf", label: "Super Formula" }, { value: "gt3", label: "GT3" }, { value: "imsa", label: "IMSA GTP / LMP2" }] as const).filter((option) => perfTabsAvailable.includes(option.value));
  const gapItems = data.winnerGapBySegment ? data.winnerGapBySegment[activePerfTab] : data.winnerGapByTrack ?? [];
  const seasonWeek = data.kpis.formula.irating.week;

  return (
    <div className="ng-page">
      <main className="ng-main ngo-main">
        {message && <div className="ngo-banner" role="status">{message}</div>}

        <PageTitle
          eyebrow={<><span className="ngo-eb-full">{`${data.season.current.name} · ${weekLabel(seasonWeek)} · vs. ${data.season.previous.name}`}</span><span className="ngo-eb-short">{`${shortSeason(data.season.current.name)} · ${weekLabel(seasonWeek)}`}</span></>}
          title={<><span className="ngo-eb-full">Visão Geral da Temporada</span><span className="ngo-eb-short">Visão Geral</span></>}
          aside={<div className="ngo-aside"><div className="ngo-counter"><strong>{data.season.current.races}</strong> corridas <span>·</span> <strong>{data.season.current.laps.toLocaleString("pt-BR")}</strong> voltas</div><button type="button" className="ngo-tools-toggle" aria-label="Mais ações" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>⋯</button></div>}
        />

        {/* Ações que o mockup não redesenha e que continuam existindo: atalhos das fontes, calendário,
         * debrief da semana/season. No celular ficam atrás do botão ⋯ do cabeçalho. Ficam numa linha discreta logo abaixo do título. */}
        <div className="ngo-tools" data-open={toolsOpen ? "" : undefined}>
          <a className="quick-open-button" href="https://irstats.com/driver/958741" target="_blank" rel="noopener noreferrer" title="Abre o iRStats numa aba nova — clique no favorito lá pra importar">🔖 iRStats ↗</a>
          <a className="quick-open-button" href="https://garage61.net/app" target="_blank" rel="noopener noreferrer" title="Abre o Garage61 numa aba nova — clique no favorito lá pra importar">🔖 Garage61 ↗</a>
          <SeasonCalendarImportModal onImported={() => loadDashboard(true)} />
          <Link className="quick-open-button" href="/debriefs?scope=week">Debrief da semana</Link>
          <Link className="primary-button" href="/debriefs?scope=season">Debrief da season</Link>
        </div>

        <SegmentedControl className="ngo-mobile-filter" ariaLabel="Categoria da página" value={mobileFilter} onChange={(value) => { setMobileFilter(value); setChartSeries("all"); }}
          options={[{ value: "all", label: "Todas" }, { value: "sports", label: "Sports Car" }, { value: "formula", label: "Formula Car" }]} />

        <section className="ngo-kpis" aria-label="Indicadores da temporada">
          {kpiGroups.map((group) => (
            <div className="ngo-kpi-group" key={group.key} data-mobile-active={mobileFilter === "all" || group.key === mobileFilter ? "" : undefined}>
              <CategoryHeading category={group.category}>{group.name}</CategoryHeading>
              <div className="ngo-kpi-grid">{group.cards}</div>
            </div>
          ))}
        </section>

        <section className="ngo-row-2">
          <Panel
            className="ngo-scatter-panel"
            kicker="RACE SURVIVAL"
            title="Duração × Δ iRating"
            titleSize="md"
            actions={
              <>
                {pageFilter === "all" && (
                  <SegmentedControl ariaLabel="Categoria do gráfico" value={chartCategory} onChange={(value) => { setChartCategory(value); setChartSeries("all"); }}
                    options={[{ value: "sports", label: "Sports Car" }, { value: "formula", label: "Formula Car" }]} />
                )}
                {seriesOptions.length > 1 && (
                  <SelectPill ariaLabel="Filtrar por série" value={chartSeries} onChange={setChartSeries}
                    options={[{ value: "all", label: `Todas as séries (${categoryRaces.length})` }, ...seriesOptions.map(([series, count]) => ({ value: series, label: `${series} (${count})` }))]} />
                )}
              </>
            }
          >
            <div className="ng-panel-subtitle">Só a season atual · duração estimada (voltas × melhor volta) — pontos à esquerda indicam sessões encerradas cedo.</div>
            <RaceScatter points={scatter} />
          </Panel>

          <Panel
            className="ngo-context-panel"
            title="Contextos da semana"
            titleSize="md"
            actions={<a className="ngo-link" href="/telemetry">Telemetry Lab →</a>}
          >
            {weeklyContexts.length ? weeklyContexts.map((item) => (
              <a className="ngo-context" key={item.key} href="/telemetry" onClick={() => trackUiEvent("overview_week_context_opened", { series: item.series })}>
                <span className="ngo-context-bar" style={{ background: /formula|sf23|super/i.test(item.series) ? "var(--ng-formula)" : "var(--ng-sports)" }} />
                <span className="ngo-context-text">
                  <span className="ngo-context-track">{item.track}</span>
                  <span className="ngo-context-sub">{item.series} · {item.avg === null ? "sem histórico suficiente" : `${item.races} corridas no contexto`}</span>
                </span>
                <span className="ngo-context-avg">
                  <span style={{ color: item.avg === null ? "var(--ng-muted)" : item.avg >= 0 ? "var(--ng-gain)" : "var(--ng-loss)" }}>{item.avg === null ? "—" : signedNumber(item.avg, 1)}</span>
                  <small>Δ médio</small>
                </span>
              </a>
            )) : <p className="ngo-empty">Ainda não há corridas desta week para formar os contextos ativos.</p>}
          </Panel>
        </section>

        <section className="ngo-perf">
          <div className="ngo-perf-head">
            <div>
              <div className="ng-kicker">HISTORICAL PERFORMANCE</div>
              <h2 className="ng-panel-title" data-size="lg">Performance por contexto</h2>
              <div className="ng-panel-subtitle">Todo o período com dados detalhados disponíveis · onde você rende melhor e pior, por duas medidas.</div>
            </div>
            <div className="ngo-perf-controls">
              {perfTabOptions.length > 1 && (
                <SegmentedControl ariaLabel="Categoria de performance" value={activePerfTab} onChange={setPerfTab} options={perfTabOptions} />
              )}
              {activePerfTab !== "sf" && (
                <SegmentedControl ariaLabel="Agrupar por" value={perfMode as RankingMode}
                  onChange={(mode) => (activePerfTab === "gt3" ? setGt3Mode(mode) : setImsaMode(mode))}
                  options={[{ value: "track", label: "Pista" }, { value: "car", label: "Carro" }]} />
              )}
            </div>
          </div>
          <div className="ngo-perf-grid">
            <Panel kicker={`MEDIDA 1 · ${perfLabel}`} title={`Média de Δ iRating por ${perfMode === "car" ? "carro" : "pista"}`} titleSize="sm" as="article"
              actions={activePerfTab === "imsa" && imsaMode === "track" ? (
                <SegmentedControl ariaLabel="Classe IMSA" value={imsaClass} onChange={setImsaClass}
                  options={[{ value: "all", label: "Todos" }, { value: "GTP", label: "GTP" }, { value: "LMP2", label: "LMP2" }]} />
              ) : undefined}>
              <DeltaByContext items={perfItems} kind={perfMode as RankingMode} />
            </Panel>
            <Panel kicker={`MEDIDA 2 · ${perfLabel} · GAP PARA O VENCEDOR`} title="Sua melhor volta vs. a do vencedor" titleSize="sm" as="article"
              subtitle={<>Vencedor da sua classe, por pista · do menor para o maior gap percentual{gapItems.length ? ` · média geral ${percentText(gapOverall(gapItems))}` : ""}</>}>
              <GapToWinner items={gapItems} />
            </Panel>
          </div>
        </section>

        <Panel title="Últimas corridas" titleSize="md" className="ngo-races-panel" subtitle={undefined}>
          <LatestRaces races={racesShown} />
        </Panel>
      </main>
    </div>
  );
}

function percentText(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
