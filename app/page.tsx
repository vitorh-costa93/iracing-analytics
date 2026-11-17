"use client";

import { useCallback, useEffect, useState } from "react";
import "./night-grid-overview.css";
import "./night-grid-telemetry.css";
import "./night-grid-debriefs.css";
import Link from "next/link";
import SeasonCalendarImportModal from "@/components/SeasonCalendarImportModal";
import { CategoryHeading, KpiCard, Panel, PageTitle, SegmentedControl, SelectPill } from "@/components/ui";
import type { KpiCategory, KpiTone } from "@/components/ui";
import RaceScatter from "@/components/overview/RaceScatter";
import LatestRaces from "@/components/overview/LatestRaces";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import { WeekPressureBars } from "@/components/debriefs/DebriefCharts";
import { useIsMobile } from "@/lib/use-is-mobile";
import { signedNumber } from "@/components/overview/format";
import { weekLabel, weekShort } from "@/lib/season-week";
import { carryForwardSeries } from "@/lib/sparkline";
import { DATA_SYNC_DONE_EVENT, DATA_SYNC_PROGRESS_EVENT, type DataSyncDetail } from "@/lib/data-sync-action";

type Category = "formula" | "sports";

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
  expectedVsReal?: {
    formula_car: { realDelta: number | null; expectedDelta: number | null; residualTotal: number | null; residualAvg: number | null; races: number };
    sports_car: { realDelta: number | null; expectedDelta: number | null; residualTotal: number | null; residualAvg: number | null; races: number };
  };
};

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

function stripFixedSuffix(series: string) {
  return series.replace(/\s*[-–—]?\s*\(?fixed\)?\s*$/i, "").trim();
}

function shortSeason(name: string) {
  return name.replace(" Season ", " S");
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState<Category>("sports");
  // Celular (etapa 7, Mobile.dc.html): mostra uma categoria de KPIs por vez; no desktop as duas aparecem.
  const [mobileFilter, setMobileFilter] = useState<"all" | Category>("all");
  const isMobile = useIsMobile();
  // No celular o filtro do topo vale para a página inteira (KPIs, gráfico, corridas).
  const pageFilter: "all" | Category = isMobile ? mobileFilter : "all";
  // Options depend on which series this driver actually raced in that category this season, not a
  // hardcoded taxonomy — the real list (GT3 Challenge Fixed, IMSA, GT Sprint, Prototype, LMP2...)
  // is messier than "GT3/IMSA x Open/Fixed" and a fixed set would silently exclude series outside it.
  const [chartSeries, setChartSeries] = useState<string>("all");
  const [toolsOpen, setToolsOpen] = useState(false);

  const loadDashboard = useCallback(async (force = false) => {
    const cacheKey = "iracing-dashboard-overview-v2";
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

  // The native agent writes outside this tab. Revalidate cached reads on return from the game
  // and while visible; never trigger Garage61 sync or heavy force-refresh from a timer.
  useEffect(() => {
    let last = Date.now();
    const revalidate = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      void loadDashboard();
    };
    const timer = window.setInterval(revalidate, 120_000);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
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

  if (loading) {
    return <div className="ng-page"><main className="ng-main"><div className="ngo-empty">Carregando Racing Analytics...</div></main></div>;
  }

  if (!data) {
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

  const pressureWeeks = data.weekly[activeChartCategory].current.map((point) => ({
    week: point.week,
    delta: point.delta ?? 0,
    races: point.races,
    severeLosses: 0,
  }));

  const carClassByCar = new Map<string, string | null>();
  for (const row of data.historical) {
    if (!carClassByCar.has(row.car)) carClassByCar.set(row.car, row.carClass);
  }
  const scheduledContexts = data.weeklyContexts ?? [];
  const weeklyContexts = (scheduledContexts.length
    ? scheduledContexts.map((context) => ({
      kind: context.kind,
      series: context.series,
      track: context.track,
      matches: (row: HistoricalRow) => scheduledContextMatches(context, row),
    }))
    : data.races.filter((race) => race.seasonWeek === data.kpis.formula.irating.week).map((race) => {
    const carClass = carClassByCar.get(race.car) ?? null;
    return {
      kind: /super formula/i.test(race.car) ? "sf23" : (carClass === "GTP" || carClass === "LMP2") ? "imsa" : "gt3",
      series: stripFixedSuffix(race.series ?? race.car),
      track: race.track,
      matches: (row: HistoricalRow) => row.track === race.track && (carClass ? row.carClass === carClass : row.car === race.car),
    };
  })).reduce<Array<{ key: string; kind: string; series: string; track: string; avg: number | null; races: number; isFormula: boolean }>>((items, context) => {
    const key = `${context.series}::${context.track}`;
    if (items.some((item) => item.key === key)) return items;
    const contextRows = data.historical.filter(context.matches);
    const isFormula = contextRows.length > 0 ? contextRows.every((row) => /super formula/i.test(row.car)) : /super formula|formula/i.test(context.series);
    const races = contextRows.reduce((sum, row) => sum + row.races, 0);
    const avg = races >= 2 ? contextRows.reduce((sum, row) => sum + row.delta, 0) / races : null;
    items.push({ key, kind: context.kind, series: context.series, track: context.track, avg, races, isFormula });
    return items;
  }, []).filter((item) => pageFilter === "all" || (pageFilter === "formula") === item.isFormula).slice(0, 3);

  // ---- Night Grid: dados dos KPIs (mesmas fontes de antes: data.kpis, data.streaks, data.weekly, data.races)
  const prevShort = previousLabel.replace(/^\d{4}\s*/, "");
  const currentRaceRows = (category: "formula_car" | "sports_car") => data.races.filter((race) => race.ratingCategory === category);
  const weekSeries = (points: WeekPoint[]) => carryForwardSeries(points.map((point) => point.iratingEnd));
  const kpiGroups = (["formula", "sports"] as const).map((key) => {
    const kpi = data.kpis[key];
    const category = key === "formula" ? "formula_car" : "sports_car";
    const rvse = data.expectedVsReal?.[category];
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
    const rvseTotal = rvse?.residualTotal ?? null;
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
          description={`Tracejado: ${prevShort}${kpi.irating.previousSameWeek === null ? "" : ` · ${prevShort} na mesma week: ${kpi.irating.previousSameWeek.toLocaleString("pt-BR")}`}`} />,
        /* Só aparece no celular (Mobile.dc.html tem Safety Rating como cartão próprio); no desktop o selo do iRating cobre. */
        <div key="sr" className="ngo-kpi-sr-wrap"><KpiCard category={key} label="Safety Rating" value={kpi.safetyRating.currentDisplay ?? "—"} /></div>,
        <KpiCard key="w" category={key} label="Vitórias"
          value={kpi.wins.current === null ? "—" : kpi.wins.current.toLocaleString("pt-BR")}
          trend={winsDiff === null ? "Sem comparação anterior" : `${arrow(winsDiff)} ${signedNumber(winsDiff)} vs. ${prevShort}`}
          trendTone={toneOf(winsDiff)}
          sparkline={winSteps.length ? { kind: "steps", values: winSteps } : undefined}
          description={`Vitórias registradas · ${prevShort}: ${kpi.wins.previous?.toLocaleString("pt-BR") ?? "—"}`} />,
        <KpiCard key="rvse" category={key} label="Resultado vs Esperado"
          value={rvseTotal === null ? "—" : signedNumber(rvseTotal)}
          trend={rvse && rvse.realDelta !== null && rvse.expectedDelta !== null ? `Real ${signedNumber(rvse.realDelta)} vs. Esp ${signedNumber(rvse.expectedDelta)}` : "Sem campo importado"}
          trendTone={toneOf(rvseTotal)}
          sparkline={rows.length ? { kind: "bars", values: rows.slice(-12).map((race) => race.delta ?? 0) } : undefined}
          description={rvse && rvse.races > 0 ? `${rvse.races} corridas · média ${signedNumber(rvse.residualAvg ?? 0, 1)}/corrida` : "Importe o campo via agente"} />,
      ],
    };
  });

  const seasonWeek = data.kpis.formula.irating.week;
  const lastRace = data.races[0] ?? null;

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

        <div className="ngo-hero-split">
          <div className="ngo-left-col">
            <section className="ngo-kpis-stacked" aria-label="Indicadores da temporada">
              {kpiGroups.map((group) => (
                <div className="ngo-kpi-group" key={group.key} data-mobile-active={mobileFilter === "all" || group.key === mobileFilter ? "" : undefined}>
                  <CategoryHeading category={group.category}>{group.name}</CategoryHeading>
                  <div className="ngo-kpi-grid">{group.cards}</div>
                </div>
              ))}
            </section>

            <div className="ngo-season-charts">
              {pageFilter === "all" && (
                <div className="ngo-season-charts-head">
                  <span className="ng-kicker">ANÁLISE DA SEASON · CATEGORIA</span>
                  <SegmentedControl ariaLabel="Categoria dos gráficos da season" value={chartCategory} onChange={(value) => { setChartCategory(value); setChartSeries("all"); }}
                    options={[{ value: "sports", label: "Sports Car" }, { value: "formula", label: "Formula Car" }]} />
                </div>
              )}

              <Panel
                className="ngo-scatter-panel"
                kicker="RACE SURVIVAL"
                title="Duração × Δ iRating"
                titleSize="md"
                actions={
                  seriesOptions.length > 1 ? (
                    <SelectPill ariaLabel="Filtrar por série" value={chartSeries} onChange={setChartSeries}
                      options={[{ value: "all", label: `Todas as séries (${categoryRaces.length})` }, ...seriesOptions.map(([series, count]) => ({ value: series, label: `${series} (${count})` }))]} />
                  ) : undefined
                }
              >
                <div className="ng-panel-subtitle">Só a season atual · duração estimada (voltas × melhor volta) — pontos à esquerda indicam sessões encerradas cedo.</div>
                <RaceScatter points={scatter} />
              </Panel>

              <Panel
                className="ngo-pressure-panel"
                kicker="SEASON DEBRIEF · SALDO SEMANAL"
                title="Δ de iRating por semana"
                titleSize="md"
                actions={<Link className="ngo-link" href="/debriefs?scope=season">Debrief da season →</Link>}
              >
                {pressureWeeks.length ? <WeekPressureBars weeks={pressureWeeks} /> : <p className="ngo-empty">Ainda não há semanas fechadas nesta season.</p>}
              </Panel>
            </div>
          </div>

          <div className="ngo-right-col">
            <Panel
              className="ngo-telem-panel"
              kicker="TELEMETRY LAB · SEMANA ATIVA"
              title="Telemetria da semana atual"
              titleSize="md"
              actions={<Link className="ngo-link" href="/telemetry">Abrir Telemetry Lab →</Link>}
            >
              <ActiveWeekTelemetry embedded weeklyContexts={weeklyContexts} lastRace={lastRace} />
            </Panel>
          </div>
        </div>

        <Panel title="Últimas corridas" titleSize="md" className="ngo-races-panel" subtitle={undefined}>
          <LatestRaces races={racesShown} />
        </Panel>
      </main>
    </div>
  );
}
