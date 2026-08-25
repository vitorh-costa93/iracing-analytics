"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import KpiCard from "@/components/KpiCard";
import PerformanceRanking from "@/components/PerformanceRanking";
import SeasonChart from "@/components/SeasonChart";
import AppTabs from "@/components/AppTabs";
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
  ratingCategory: "formula_car" | "sports_car";
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
  races: Array<{ id: number; startedAt: string; endedAt: string; durationMinutes: number | null; delta: number | null; ratingCategory: "formula_car" | "sports_car" | null; series: string | null; car: string; track: string; bestLap: string | null; startPosition: number | null; finishPosition: number | null }>;
};

type RankingItem = { label: string; delta: number; races: number; group?: string | null; avgDelta: number };

function shortSeason(name: string) {
  return name.replace(" Season ", " S");
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

  return [...map.values()].sort((a, b) => b.avgDelta - a.avgDelta);
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState<Category>("formula");
  const [gt3Mode, setGt3Mode] = useState<RankingMode>("car");
  const [imsaMode, setImsaMode] = useState<RankingMode>("car");

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

  async function syncData() {
    setSyncing(true);
    setMessage("Abrindo Garage61 e iRStats, depois atualizando dados via Supabase...");
    try {
      window.open("https://garage61.net/app", "_blank", "noopener,noreferrer");
      window.open("https://irstats.com/driver/958741", "_blank", "noopener,noreferrer");

      const generalResponse = await fetch("/api/sync/all", { method: "POST" });
      const generalResult = await generalResponse.json();
      if (!generalResponse.ok) throw new Error(generalResult.message ?? "Erro na sincronização geral");

      setMessage("Atualizando sessões recentes do Garage61...");
      const sessionsResponse = await fetch("/api/sync/incremental", { method: "POST" });
      const sessionsResult = await sessionsResponse.json();
      if (!sessionsResponse.ok) throw new Error(sessionsResult.message ?? "Erro na sincronização de sessões");

      setMessage("Atualizando histórico de rating do Garage61...");
      const ratingsResponse = await fetch("/api/sync/rating-history", { method: "POST" });
      const ratingsResult = await ratingsResponse.json();
      if (!ratingsResponse.ok) throw new Error(ratingsResult.message ?? "Erro na sincronização de ratings");

      setMessage("Garage61 atualizado. A aba do iRStats foi aberta; acione o importador browser-side para enviar somente corridas ainda ausentes.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  }

  const rankings = useMemo(() => {
    if (!data) return null;

    const trackRows = data.historical.filter((row) => row.ratingCategory === "formula_car");
    const gt3Rows = data.historical.filter((row) => row.carClass === "GT3");
    const imsaRows = data.historical.filter((row) => row.carClass === "GTP" || row.carClass === "LMP2");

    return {
      tracks: aggregateRows(trackRows, "track"),
      gt3: aggregateRows(gt3Rows, gt3Mode, false),
      imsa: aggregateRows(imsaRows, imsaMode, true),
    };
  }, [data, gt3Mode, imsaMode]);

  if (loading) {
    return <main className="app-shell"><div className="state-box">Carregando Racing Analytics...</div></main>;
  }

  if (!data || !rankings) {
    return <main className="app-shell"><div className="state-box error">{message ?? "Não foi possível carregar os dados."}<button type="button" className="retry-button" onClick={() => loadDashboard()}>Tentar novamente</button></div></main>;
  }

  const currentLabel = shortSeason(data.season.current.name);
  const previousLabel = shortSeason(data.season.previous.name);
  const weekly = chartCategory === "formula" ? data.weekly.formula : data.weekly.sports;
  const scatter = data.races.filter((race) => race.ratingCategory === (chartCategory === "formula" ? "formula_car" : "sports_car") && race.delta !== null).map((race) => ({ id: race.id, durationMinutes: race.durationMinutes, delta: race.delta!, car: race.car, track: race.track, startedAt: race.startedAt }));

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
            <button className="primary-button" onClick={syncData} disabled={syncing}>
              {syncing ? "Atualizando..." : "Atualizar dados"}
            </button>
          </div>
        </header>
        <AppTabs />

        {message && <div className="status-banner">{message}</div>}

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
            <KpiCard eyebrow="Formula Car • iRating" value={data.kpis.formula.irating.current} previousValue={data.kpis.formula.irating.previousSameWeek} previousLabel={`${previousLabel} W${data.kpis.formula.irating.week}`} />
            <KpiCard eyebrow="Sports Car • iRating" value={data.kpis.sports.irating.current} previousValue={data.kpis.sports.irating.previousSameWeek} previousLabel={`${previousLabel} W${data.kpis.sports.irating.week}`} />
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
              <button className={chartCategory === "formula" ? "active" : ""} onClick={() => setChartCategory("formula")}>Formula Car</button>
              <button className={chartCategory === "sports" ? "active" : ""} onClick={() => setChartCategory("sports")}>Sports Car</button>
            </div>
          </div>
          <SeasonChart current={weekly.current} previous={weekly.previous} currentName={currentLabel} previousName={previousLabel} />
        </article>
        <article className="panel large-panel">
          <div className="panel-heading"><div><span className="section-kicker">RACE SURVIVAL</span><h2>Duração × Δ iRating</h2><p>Somente corridas da season atual. Duração estimada (voltas × melhor volta) — pontos à esquerda indicam sessões encerradas cedo.</p></div></div>
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
                <div><span className="section-kicker">TRACK PERFORMANCE</span><h3>Média de Δ iRating por pista</h3></div>
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
