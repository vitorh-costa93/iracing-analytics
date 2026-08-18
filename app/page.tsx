"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import KpiCard from "@/components/KpiCard";
import PerformanceRanking from "@/components/PerformanceRanking";
import SeasonChart from "@/components/SeasonChart";

type Category = "formula" | "sports";
type RankingMode = "car" | "track";

type WeekPoint = {
  week: number;
  weekStart: string;
  weekEnd: string;
  iratingBeforeWeek: number | null;
  iratingFirst: number | null;
  iratingEnd: number | null;
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
  kpis: {
    formula: {
      current: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      previous: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      wins: { current: number | null; previous: number | null };
    };
    sports: {
      current: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      previous: { delta: number; races: number; avgDelta: number | null; medianDelta: number | null; positivePct: number | null };
      wins: { current: number | null; previous: number | null };
    };
  };
  weekly: {
    formula: { current: WeekPoint[]; previous: WeekPoint[] };
    sports: { current: WeekPoint[]; previous: WeekPoint[] };
  };
  historical: HistoricalRow[];
  featureAvailability: { wins: boolean; winsReason: string };
};

type RankingItem = { label: string; delta: number; races: number; group?: string | null };

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
    const current = map.get(mapKey) ?? { label, delta: 0, races: 0, group };
    current.delta += row.delta;
    current.races += row.races;
    map.set(mapKey, current);
  }

  return [...map.values()].sort((a, b) => b.delta - a.delta);
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [chartCategory, setChartCategory] = useState<Category>("formula");
  const [trackCategory, setTrackCategory] = useState<Category>("formula");
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
    setMessage("Atualizando perfil, ratings, catálogo e atividade...");
    try {
      const generalResponse = await fetch("/api/sync/all", { method: "POST" });
      const generalResult = await generalResponse.json();
      if (!generalResponse.ok) throw new Error(generalResult.message ?? "Erro na sincronização geral");

      setMessage("Atualizando histórico de iRating...");
      const ratingResponse = await fetch("/api/sync/rating-history", { method: "POST" });
      const ratingResult = await ratingResponse.json();
      if (!ratingResponse.ok) throw new Error(ratingResult.message ?? "Erro ao atualizar histórico de iRating");

      setMessage("Dados gerais e iRating atualizados. O backfill completo de voltas não foi reprocessado.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  }

  const rankings = useMemo(() => {
    if (!data) return null;

    const categoryKey = trackCategory === "formula" ? "formula_car" : "sports_car";
    const trackRows = data.historical.filter((row) => row.ratingCategory === categoryKey);
    const gt3Rows = data.historical.filter((row) => row.carClass === "GT3");
    const imsaRows = data.historical.filter((row) => row.carClass === "GTP" || row.carClass === "LMP2");

    return {
      tracks: aggregateRows(trackRows, "track"),
      gt3: aggregateRows(gt3Rows, gt3Mode, false),
      imsa: aggregateRows(imsaRows, imsaMode, true),
    };
  }, [data, trackCategory, gt3Mode, imsaMode]);

  if (loading) {
    return <main className="app-shell"><div className="state-box">Carregando Racing Analytics...</div></main>;
  }

  if (!data || !rankings) {
    return <main className="app-shell"><div className="state-box error">{message ?? "Não foi possível carregar os dados."}</div></main>;
  }

  const currentLabel = shortSeason(data.season.current.name);
  const previousLabel = shortSeason(data.season.previous.name);
  const weekly = chartCategory === "formula" ? data.weekly.formula : data.weekly.sports;

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

        {message && <div className="status-banner">{message}</div>}

        <section className="section-block">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">SEASON PERFORMANCE</span>
              <h2>{currentLabel} <em>vs</em> {previousLabel}</h2>
            </div>
            <div className="season-summary">
              <strong>{data.season.current.races}</strong> corridas <span>•</span> <strong>{data.season.current.laps.toLocaleString("pt-BR")}</strong> voltas
            </div>
          </div>

          <div className="kpi-grid">
            <KpiCard eyebrow="Formula Car • Δ iRating" value={data.kpis.formula.current.delta} previousValue={data.kpis.formula.previous.delta} previousLabel={previousLabel} />
            <KpiCard eyebrow="Sports Car • Δ iRating" value={data.kpis.sports.current.delta} previousValue={data.kpis.sports.previous.delta} previousLabel={previousLabel} />
            <KpiCard eyebrow="Formula Car • Vitórias" value={data.kpis.formula.wins.current} previousValue={data.kpis.formula.wins.previous} previousLabel={previousLabel} mode="count" unavailableText="Aguardando race results" />
            <KpiCard eyebrow="Sports Car • Vitórias" value={data.kpis.sports.wins.current} previousValue={data.kpis.sports.wins.previous} previousLabel={previousLabel} mode="count" unavailableText="Aguardando race results" />
          </div>
        </section>

        <section className="panel large-panel">
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
                <div><span className="section-kicker">TRACK PERFORMANCE</span><h3>Δ iRating por pista</h3></div>
                <div className="segmented-control small">
                  <button className={trackCategory === "formula" ? "active" : ""} onClick={() => setTrackCategory("formula")}>Formula</button>
                  <button className={trackCategory === "sports" ? "active" : ""} onClick={() => setTrackCategory("sports")}>Sports</button>
                </div>
              </div>
              <PerformanceRanking items={rankings.tracks} />
            </article>

            <article className="panel ranking-panel">
              <div className="panel-heading compact">
                <div><span className="section-kicker">GT3</span><h3>Performance GT3</h3></div>
                <div className="segmented-control small">
                  <button className={gt3Mode === "car" ? "active" : ""} onClick={() => setGt3Mode("car")}>Carro</button>
                  <button className={gt3Mode === "track" ? "active" : ""} onClick={() => setGt3Mode("track")}>Pista</button>
                </div>
              </div>
              <PerformanceRanking items={rankings.gt3} />
            </article>

            <article className="panel ranking-panel">
              <div className="panel-heading compact">
                <div><span className="section-kicker">IMSA</span><h3>GTP / LMP2</h3></div>
                <div className="segmented-control small">
                  <button className={imsaMode === "car" ? "active" : ""} onClick={() => setImsaMode("car")}>Carro</button>
                  <button className={imsaMode === "track" ? "active" : ""} onClick={() => setImsaMode("track")}>Pista</button>
                </div>
              </div>
              <PerformanceRanking items={rankings.imsa} />
            </article>
          </div>
        </section>

        <section className="panel telemetry-placeholder">
          <div>
            <span className="section-kicker">ACTIVE WEEK TELEMETRY</span>
            <h2>Telemetria da semana ativa</h2>
            <p>A próxima etapa identifica a pista ativa e concentra a análise apenas nas atividades da semana atual.</p>
          </div>
          <span className="coming-soon">PRÓXIMA ETAPA</span>
        </section>

        <footer>
          Racing Analytics • dados pessoais sincronizados via Garage61
        </footer>
      </div>
    </main>
  );
}
