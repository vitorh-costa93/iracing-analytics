"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import KpiCard from "@/components/KpiCard";
import PerformanceRanking from "@/components/PerformanceRanking";
import SeasonChart from "@/components/SeasonChart";
import AppTabs from "@/components/AppTabs";
import ThemeToggle from "@/components/ThemeToggle";
import RaceScatterPlot from "@/components/RaceScatterPlot";
import RaceTable from "@/components/RaceTable";

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
  featureAvailability: { wins: boolean; winsReason: string };
  races: Array<{ id: number; startedAt: string; endedAt: string; durationMinutes: number | null; delta: number | null; ratingCategory: "formula_car" | "sports_car" | null; series: string | null; car: string; track: string; seasonWeek?: number | null; bestLap: string | null; startPosition: number | null; finishPosition: number | null }>;
};

type RankingItem = { label: string; delta: number; races: number; group?: string | null; avgDelta: number };
type WeekContext = { series: string; track: string; matches: (row: HistoricalRow) => boolean };

// Weekly schedule is intentionally explicit. Garage61 exposes activity, not the official schedule;
// deriving these cards from races already driven made the section disappear before the first race.
const WEEKLY_CONTEXTS: Record<string, WeekContext[]> = {
  "34:11": [
    { series: "Super Formula 23", track: "Algarve", matches: (row) => /super formula/i.test(row.car) && /algarve|portim/i.test(row.track) },
    { series: "IMSA", track: "Road Atlanta", matches: (row) => (row.carClass === "GTP" || row.carClass === "LMP2") && /road atlanta/i.test(row.track) },
    { series: "GT3", track: "Red Bull Ring", matches: (row) => row.carClass === "GT3" && /red bull ring/i.test(row.track) },
  ],
};

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
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState<Category>("formula");
  // Options depend on which series this driver actually raced in that category this season, not a
  // hardcoded taxonomy — the real list (GT3 Challenge Fixed, IMSA, GT Sprint, Prototype, LMP2...)
  // is messier than "GT3/IMSA x Open/Fixed" and a fixed set would silently exclude series outside it.
  const [chartSeries, setChartSeries] = useState<string>("all");
  const [gt3Mode, setGt3Mode] = useState<RankingMode>("car");
  const [imsaMode, setImsaMode] = useState<RankingMode>("car");
  const [imsaClass, setImsaClass] = useState<"all" | "GTP" | "LMP2">("all");

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/overview", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao carregar dashboard");
      setData(result);
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
      void loadDashboard();
    }
    window.addEventListener("message", onImportComplete);
    return () => window.removeEventListener("message", onImportComplete);
  }, [loadDashboard]);

  // Server-side only, no browser extension involved (or needed) at all — this talks exclusively to
  // our own API, which already syncs telemetry/laps/ratings/catalog on its own via the hourly cron.
  // Getting NEW race results or setups still needs a real logged-in browser tab (see the bookmarklet
  // section below this button), since neither irstats.com nor Garage61's setup data can be reached
  // any other way, but that's a deliberate, separate, occasional action now — not tied to this click.
  async function syncData() {
    setSyncing(true);
    setMessage("Atualizando dados via Supabase...");
    try {
      const generalResponse = await fetch("/api/sync/all", { method: "POST" });
      const generalResult = await generalResponse.json();
      if (!generalResponse.ok) throw new Error(generalResult.message ?? "Erro na sincronização geral");

      setMessage("Atualizando sessões, voltas e telemetria recentes do Garage61...");
      const sessionsResponse = await fetch("/api/sync/incremental", { method: "POST" });
      const sessionsResult = await sessionsResponse.json();
      if (!sessionsResponse.ok) throw new Error(sessionsResult.message ?? "Erro na sincronização de sessões");

      setMessage("Atualizando histórico de Safety Rating do Garage61...");
      const ratingsResponse = await fetch("/api/sync/rating-history", { method: "POST" });
      const ratingsResult = await ratingsResponse.json();
      if (!ratingsResponse.ok) throw new Error(ratingsResult.message ?? "Erro na sincronização de ratings");

      setMessage(`Sincronização concluída: ${sessionsResult.sessionsUpserted ?? 0} sessões, ${sessionsResult.lapsUpserted ?? 0} voltas e ${sessionsResult.telemetryDownloaded ?? 0} telemetrias novas; ${ratingsResult.recordsSynced ?? 0} pontos de Safety Rating verificados. Para resultados/setups novos, use os favoritos abaixo.`);
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  }

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
    return <main className="app-shell"><div className="state-box">Carregando Racing Analytics...</div></main>;
  }

  if (!data || !rankings) {
    return <main className="app-shell"><div className="state-box error">{message ?? "Não foi possível carregar os dados."}<button type="button" className="retry-button" onClick={() => loadDashboard()}>Tentar novamente</button></div></main>;
  }

  const currentLabel = shortSeason(data.season.current.name);
  const previousLabel = shortSeason(data.season.previous.name);
  const weekly = chartCategory === "formula" ? data.weekly.formula : data.weekly.sports;
  const categoryRaces = data.races.filter((race) => race.ratingCategory === (chartCategory === "formula" ? "formula_car" : "sports_car") && race.delta !== null);
  // Sorted by how many races each series has this season — the driver's most-raced series leads
  // the dropdown instead of alphabetical order burying it.
  const seriesOptions = Array.from(categoryRaces.reduce((counts, race) => {
    const key = race.series ?? "Sem série";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]);
  const scatter = categoryRaces.filter((race) => chartSeries === "all" || (race.series ?? "Sem série") === chartSeries).map((race) => ({ id: race.id, durationMinutes: race.durationMinutes, delta: race.delta!, car: race.car, track: race.track, startedAt: race.startedAt }));
  const scheduleKey = `${data.season.current.id}:${data.kpis.formula.irating.week}`;
  const scheduledContexts = WEEKLY_CONTEXTS[scheduleKey];
  const weeklyContexts = (scheduledContexts ?? data.races.filter((race) => race.seasonWeek === data.kpis.formula.irating.week).map((race) => ({ series: stripFixedSuffix(race.series ?? race.car), track: race.track, matches: (row: HistoricalRow) => row.track === race.track && row.car === race.car }))).reduce<Array<{ key: string; series: string; track: string; avg: number | null; races: number }>>((items, context) => {
    const key = `${context.series}::${context.track}`;
    if (items.some((item) => item.key === key)) return items;
    const contextRows = data.historical.filter(context.matches);
    const races = contextRows.reduce((sum, row) => sum + row.races, 0);
    const avg = races >= 2 ? contextRows.reduce((sum, row) => sum + row.delta, 0) / races : null;
    items.push({ key, series: context.series, track: context.track, avg, races });
    return items;
  }, []).slice(0, 3);
  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-block">
            <div className="brand-mark"><span /></div>
            <div>
              <div className="brand-kicker">IRACING ANALYTICS</div>
              <h1>Racing Analytics</h1>
              <p>{data.driver.name} <span>•</span> iRacing #{data.driver.iracingId}</p>
            </div>
          </div>

          <div className="header-actions">
            <div className="season-chip">
              <span>SEASON</span>
              <strong>{currentLabel}</strong>
            </div>
            <button type="button" className={`primary-button ${syncing ? "disabled" : ""}`} disabled={syncing} onClick={() => void syncData()}>
              {syncing ? "Atualizando..." : "Atualizar dados"}
            </button>
            {/* These open the site in a new tab -- a real convenience (no typing the URL, no hunting
             * for the bookmarklet in Favoritos) but NOT the same as running the import: a page can't
             * inject/run a script into another origin's tab it doesn't control, so the bookmarklet
             * click on that tab is still a separate, required step. Explicit in the label so it never
             * reads as "this button does the whole sync" — it doesn't, and can't, without an
             * extension. */}
            <a className="quick-open-button" href="https://irstats.com/driver/958741" target="_blank" rel="noopener noreferrer" title="Abre o iRStats numa aba nova — clique no favorito lá pra importar">🔖 iRStats ↗</a>
            <a className="quick-open-button" href="https://garage61.net/app" target="_blank" rel="noopener noreferrer" title="Abre o Garage61 numa aba nova — clique no favorito lá pra importar">🔖 Garage61 ↗</a>
            <ThemeToggle />
          </div>
        </header>
        <AppTabs />

        {message && <div className="status-banner">{message}</div>}

        <section className="section-block week-context-section">
          <div className="section-title-row"><div><span className="section-kicker">ESSA SEMANA NO IRACING</span><h2>Seu histórico nos contextos ativos</h2><p>Média de Δ iRating por corrida na mesma pista e categoria; amostra mínima de duas corridas.</p></div></div>
          <div className="week-context-grid">{weeklyContexts.length ? weeklyContexts.map((item) => <article className="week-context-card" key={item.key}><span>{item.series}</span><h3>{item.track}</h3><strong className={item.avg === null ? "neutral" : item.avg >= 0 ? "positive" : "negative"}>{item.avg === null ? "—" : `${item.avg > 0 ? "+" : ""}${item.avg.toFixed(1)}`}</strong><small>{item.avg === null ? "Sem histórico suficiente" : `${item.races} corridas no contexto`}</small></article>) : <p className="comparison-note">Ainda não há corridas desta week para formar os contextos ativos.</p>}</div>
        </section>

        <section className="section-block">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">SEASON PERFORMANCE</span>
              <h2>{currentLabel} <em>Season to Date vs.</em> {previousLabel}</h2>
            </div>
            <div className="season-summary">
              <strong>{data.season.current.races}</strong> corridas <span>•</span> <strong>{data.season.current.laps.toLocaleString("pt-BR")}</strong> voltas
            </div>
          </div>

          <div className="kpi-grid">
            <KpiCard eyebrow="Formula Car • iRating" value={data.kpis.formula.irating.current} previousValue={data.kpis.formula.irating.previousSameWeek} previousLabel={`${previousLabel} W${data.kpis.formula.irating.week}`} safetyRatingDisplay={data.kpis.formula.safetyRating.currentDisplay} />
            <KpiCard eyebrow="Sports Car • iRating" value={data.kpis.sports.irating.current} previousValue={data.kpis.sports.irating.previousSameWeek} previousLabel={`${previousLabel} W${data.kpis.sports.irating.week}`} safetyRatingDisplay={data.kpis.sports.safetyRating.currentDisplay} />
            <KpiCard eyebrow="Formula Car • Vitórias" value={data.kpis.formula.wins.current} previousValue={data.kpis.formula.wins.previous} previousLabel={previousLabel} mode="wins" />
            <KpiCard eyebrow="Sports Car • Vitórias" value={data.kpis.sports.wins.current} previousValue={data.kpis.sports.wins.previous} previousLabel={previousLabel} mode="wins" />
          </div>
        </section>

        <section className="rating-chart-grid">
        <article className="panel large-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">IRATING EVOLUTION</span>
              <h2>Evolução semanal</h2>
              <p>iRating absoluto por semana, comparando a Season atual com a anterior.</p>
            </div>
            <div className="segmented-control">
              <button className={chartCategory === "formula" ? "active" : ""} onClick={() => { setChartCategory("formula"); setChartSeries("all"); }}>Formula Car</button>
              <button className={chartCategory === "sports" ? "active" : ""} onClick={() => { setChartCategory("sports"); setChartSeries("all"); }}>Sports Car</button>
            </div>
          </div>
          <SeasonChart current={weekly.current} previous={weekly.previous} currentName={currentLabel} previousName={previousLabel} category={chartCategory} />
        </article>
        <article className="panel large-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">RACE SURVIVAL</span><h2>Duração × Δ iRating</h2><p>Somente corridas da season atual. Duração estimada (voltas × melhor volta) — pontos à esquerda indicam sessões encerradas cedo.</p></div>
            {seriesOptions.length > 1 && (
              <div className="series-filter">
                <select value={chartSeries} onChange={(event) => setChartSeries(event.target.value)} aria-label="Filtrar por série">
                  <option value="all">Todas as séries ({categoryRaces.length})</option>
                  {seriesOptions.map(([series, count]) => <option key={series} value={series}>{series} ({count})</option>)}
                </select>
              </div>
            )}
          </div>
          <RaceScatterPlot points={scatter} />
        </article>
        </section>

        <section className="section-block historical-section">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">HISTORICAL PERFORMANCE</span>
              <h2>Performance por contexto</h2>
              <p>Todo o período com dados detalhados disponíveis.</p>
            </div>
          </div>

          <div className="performance-grid">
            <article className="panel ranking-panel">
              <div className="panel-heading compact">
                <div><span className="section-kicker">SUPER FORMULA 23</span><h3>Média de Δ iRating por pista</h3></div>
              </div>
              <PerformanceRanking items={rankings.tracks} kind="track" />
            </article>

            <article className="panel ranking-panel">
              <div className="panel-heading compact">
                <div><span className="section-kicker">GT3</span><h3>Performance GT3</h3></div>
                <div className="segmented-control small">
                  <button className={gt3Mode === "car" ? "active" : ""} onClick={() => setGt3Mode("car")}>Carro</button>
                  <button className={gt3Mode === "track" ? "active" : ""} onClick={() => setGt3Mode("track")}>Pista</button>
                </div>
              </div>
              <PerformanceRanking items={rankings.gt3} kind={gt3Mode} />
            </article>

            <article className="panel ranking-panel">
              <div className="panel-heading compact">
                <div><span className="section-kicker">IMSA</span><h3>GTP / LMP2</h3></div>
                <div className="segmented-control small">
                  <button className={imsaMode === "car" ? "active" : ""} onClick={() => setImsaMode("car")}>Carro</button>
                  <button className={imsaMode === "track" ? "active" : ""} onClick={() => setImsaMode("track")}>Pista</button>
                </div>
              </div>
              {imsaMode === "track" && <div className="segmented-control small ranking-subfilter">
                <button className={imsaClass === "all" ? "active" : ""} onClick={() => setImsaClass("all")}>Todos</button>
                <button className={imsaClass === "GTP" ? "active" : ""} onClick={() => setImsaClass("GTP")}>GTP</button>
                <button className={imsaClass === "LMP2" ? "active" : ""} onClick={() => setImsaClass("LMP2")}>LMP2</button>
              </div>}
              <PerformanceRanking items={rankings.imsa} kind={imsaMode} />
            </article>
          </div>
        </section>

        <section className="panel season-races-panel">
          <div className="panel-heading"><div><span className="section-kicker">SEASON RACES</span><h2>Todas as corridas da temporada</h2><p>Melhor volta e delta vêm do Garage61; grid e chegada aparecem quando a fonte oficial disponibilizar o resultado.</p></div></div>
          <RaceTable races={data.races} />
        </section>

        <footer>
          Racing Analytics • dados pessoais sincronizados via Garage61
        </footer>
      </div>
    </main>
  );
}
