"use client";

import { useEffect, useState } from "react";

type Category = "gt3" | "gtp";
const CATEGORIES: Category[] = ["gt3", "gtp"];
const CATEGORY_LABEL: Record<Category, string> = { gt3: "GT3", gtp: "GTP" };

type TrackCategoryOption = { category: Category; label: string; carCount: number; carNames: string[] };
type TrackOption = { trackId: number; trackName: string; trackVariant: string | null; categories: TrackCategoryOption[] };
type SeasonOption = { seasonId: string; seasonName: string; lapCount: number; latestStartedAt: string };
type ChannelConsistency = { channel: string; name: string; score: number; label: string };
type InputConsistency = { overall: { score: number; label: string }; channels: ChannelConsistency[] } | null;
type LapTimeConsistency = { stddev: number; label: string } | null;
type TrackUsage = { avgPct: number; maxPct: number } | null;
type CarStat = {
  carId: number; carName: string; lapsAnalyzed: number;
  bestLapSeconds: number; bestLapFormatted: string; deltaSeconds: number;
  lapTimeConsistency: LapTimeConsistency; inputConsistency: InputConsistency; trackUsage: TrackUsage;
  trackUsageSegments: (number | null)[] | null;
};
type ComparisonPayload = {
  status: string; track: { id: number; name: string; variant: string | null } | null;
  seasons?: SeasonOption[]; selectedSeasonId?: string | null;
  cars: CarStat[]; message?: string;
};

const CONSISTENCY_CLASS: Record<string, string> = { "muito consistente": "great", "consistente": "good", "variável": "warn", "muito inconsistente": "bad" };

/** Used only for the best-lap ranking now (29/08/2026: "gráfico de barras horizontais, só manter
 * para o ranking por carro") -- consistency and track usage below reuse other sub-tabs' own visual
 * styles instead of this. */
function CompareBar({ label, value, max, formatted }: { label: string; value: number; max: number; formatted: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="car-compare-row">
      <span className="car-compare-row-label">{label}</span>
      <div className="car-compare-row-track"><div className="car-compare-row-fill" style={{ width: `${pct}%` }} /></div>
      <span className="car-compare-row-value">{formatted}</span>
    </div>
  );
}

/** Same visual as Meu Debrief's own "CONSISTÊNCIA POR CANAL" (race-debrief-channel-bars), reused
 * verbatim per car here (29/08/2026: "a parte de consistência ser igual a que temos em Meu
 * Debrief") instead of a bespoke bar style. */
function ChannelBars({ channels }: { channels: ChannelConsistency[] }) {
  const max = Math.max(...channels.map((item) => item.score), 0.01);
  return (
    <div className="race-debrief-channel-bars">
      {channels.slice().sort((a, b) => a.score - b.score).map((item) => (
        <div className="race-debrief-channel-row" key={item.channel}>
          <span>{item.name}</span>
          <div className="race-debrief-channel-track"><div style={{ width: `${Math.max(4, (item.score / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Track usage broken into fixed %-of-lap segments instead of one aggregate number (29/08/2026:
 * "Track Usage dá pra fazer algo mais quebrado em curvas ou sub-trechos para identificar as
 * principais diferenças de uso de pista") -- a small heat strip per car, colored by how much of the
 * tagged track width that segment uses. */
function usageColor(pct: number | null) {
  if (pct === null) return "transparent";
  const clamped = Math.max(0, Math.min(150, pct));
  // green (center-hugging) -> amber -> red (riding the edge/curbs), same intent as the app's other
  // consistency color scale, just continuous instead of bucketed.
  if (clamped < 50) return `color-mix(in srgb, var(--green) ${100 - clamped * 2}%, var(--amber) ${clamped * 2}%)`;
  return `color-mix(in srgb, var(--amber) ${100 - Math.min(100, (clamped - 50) * 2)}%, var(--red) ${Math.min(100, (clamped - 50) * 2)}%)`;
}

function TrackUsageStrip({ segments }: { segments: (number | null)[] }) {
  return (
    <div className="track-usage-strip">
      {segments.map((pct, index) => (
        <div key={index} className="track-usage-cell" style={{ background: usageColor(pct) }} title={pct === null ? "sem dado" : `${pct.toFixed(0)}%`} />
      ))}
    </div>
  );
}

/** For each fixed segment, the spread between the car using the MOST and the LEAST of the track's
 * width -- sorted descending, top few surfaced as text so the driver doesn't have to eyeball ten
 * thin strips per car to find where the cars actually diverge. */
function biggestUsageDifferences(cars: CarStat[], segmentCount: number) {
  const rows: { segment: number; spread: number; maxCar: string; maxPct: number; minCar: string; minPct: number }[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const values = cars.map((car) => ({ car: car.carName, pct: car.trackUsageSegments?.[segment] ?? null })).filter((item): item is { car: string; pct: number } => item.pct !== null);
    if (values.length < 2) continue;
    const max = values.reduce((a, b) => (b.pct > a.pct ? b : a));
    const min = values.reduce((a, b) => (b.pct < a.pct ? b : a));
    if (max.car === min.car) continue;
    rows.push({ segment, spread: max.pct - min.pct, maxCar: max.car, maxPct: max.pct, minCar: min.car, minPct: min.pct });
  }
  return rows.sort((a, b) => b.spread - a.spread).slice(0, 3);
}

export default function CarComparison() {
  const [tracks, setTracks] = useState<TrackOption[] | null>(null);
  // Only GT3 and GTP are offered (29/08/2026: "Super Fórmula e LMP2 não se aplicam aqui porque não
  // tem diferença de carro") -- this driver only ever tests multiple distinct cars within these two.
  const [category, setCategory] = useState<Category>("gt3");
  const [trackId, setTrackId] = useState<number | null>(null);
  // "auto" lets the server pick the most recent season with data (BoP changes between seasons, see
  // ChannelBars/season-picker comments below); "all" removes the season filter entirely; anything
  // else is a specific season_id.
  const [season, setSeason] = useState<string>("auto");
  const [data, setData] = useState<ComparisonPayload | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/telemetry/car-comparison", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao buscar pistas");
        setTracks(result.tracks);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingTracks(false));
    return () => { active = false; };
  }, []);

  const tracksForCategory = (tracks ?? []).filter((track) => track.categories.some((entry) => entry.category === category));

  // Whenever the category changes (or the track list first loads), make sure the selected track is
  // actually valid for that category -- otherwise fall back to the first eligible one, or none.
  // Season resets to "auto" too: a different track/category has its own season coverage.
  useEffect(() => {
    if (!tracks) return;
    setSeason("auto");
    if (trackId !== null && tracksForCategory.some((track) => track.trackId === trackId)) return;
    setTrackId(tracksForCategory[0]?.trackId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, category]);

  useEffect(() => {
    if (trackId === null) return;
    let active = true;
    setLoadingData(true);
    setError(null);
    fetch(`/api/telemetry/car-comparison?trackId=${trackId}&category=${category}${season !== "auto" ? `&season=${season}` : ""}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao comparar carros");
        setData(result);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingData(false));
    return () => { active = false; };
  }, [trackId, category, season]);

  if (loadingTracks) return <div className="telemetry-state">Buscando pistas onde você testou mais de um carro...</div>;
  if (error) return <div className="telemetry-state error">{error}</div>;

  const maxDelta = Math.max(0.05, ...(data?.cars.map((car) => car.deltaSeconds) ?? [0]));
  const activeSeasonValue = season !== "auto" ? season : data?.selectedSeasonId ?? "all";
  const differences = data?.cars.length ? biggestUsageDifferences(data.cars, Math.max(...data.cars.map((car) => car.trackUsageSegments?.length ?? 0))) : [];

  return (
    <div className="car-comparison">
      <div className="race-debrief-category-toggle">
        {CATEGORIES.map((item) => (
          <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{CATEGORY_LABEL[item]}</button>
        ))}
      </div>

      {!tracksForCategory.length ? (
        <div className="telemetry-state">Nenhuma pista com voltas válidas de dois ou mais carros de {CATEGORY_LABEL[category]} ainda. Isso aparece aqui assim que você tiver sessões de test drive ou practice com carros diferentes dessa categoria na mesma pista.</div>
      ) : (
        <>
          <div className="car-compare-picker">
            <span className="section-kicker">COMPARAR CARROS NA MESMA PISTA</span>
            {!!data?.seasons?.length && (
              <>
                <select value={activeSeasonValue} onChange={(event) => setSeason(event.target.value)}>
                  <option value="all">Todas as temporadas</option>
                  {data.seasons.map((item) => <option key={item.seasonId} value={item.seasonId}>{item.seasonName}</option>)}
                </select>
                <p className="comparison-note">BoP muda entre temporadas — por padrão só a mais recente com dados entra na comparação. Troque acima se quiser ver outra ou juntar todas.</p>
              </>
            )}
            <select value={trackId ?? ""} onChange={(event) => setTrackId(Number(event.target.value))}>
              {tracksForCategory.map((track) => {
                const entry = track.categories.find((item) => item.category === category)!;
                return <option key={track.trackId} value={track.trackId}>{track.trackName}{track.trackVariant ? ` (${track.trackVariant})` : ""} — {entry.carCount} carros</option>;
              })}
            </select>
          </div>

          {loadingData ? (
            <div className="telemetry-state">Baixando telemetria dos carros testados nessa pista...</div>
          ) : !data?.cars.length ? (
            <div className="telemetry-state">{data?.message ?? "Sem dados suficientes para essa pista."}</div>
          ) : (
            <>
              <div className="race-debrief-chart-block">
                <span className="section-kicker">MELHOR VOLTA</span>
                <h4>Ranking por carro — {data.track?.name}{data.track?.variant ? ` (${data.track.variant})` : ""}</h4>
                <p className="race-debrief-channels-note">O primeiro é a volta mais rápida entre todos os carros nessa pista; os demais mostram a diferença para ela.</p>
                <div className="car-compare-block">
                  {data.cars.map((car) => (
                    <CompareBar key={car.carId} label={car.carName} value={car.deltaSeconds || maxDelta * 0.02} max={maxDelta}
                      formatted={car.deltaSeconds === 0 ? `${car.bestLapFormatted} (referência)` : `+${car.deltaSeconds.toFixed(3)}s`} />
                  ))}
                </div>
              </div>

              <div className="race-debrief-chart-block">
                <span className="section-kicker">CONSISTÊNCIA</span>
                <h4>Tempo de volta e comandos, por carro</h4>
                <p className="race-debrief-channels-note">Tempo de volta já sem sujeira (voltas anormalmente lentas descartadas antes do cálculo do desvio padrão). Comandos usam o mesmo formato de barras do Meu Debrief, por carro.</p>
                <div className="car-compare-cars-grid">
                  {data.cars.map((car) => (
                    <div className="car-compare-car-block" key={car.carId}>
                      <h5>{car.carName}</h5>
                      {car.lapTimeConsistency ? (
                        <span className={`corner-chip ${CONSISTENCY_CLASS[car.lapTimeConsistency.label] ?? ""}`}>Tempo de volta: {car.lapTimeConsistency.stddev.toFixed(3)}s • {car.lapTimeConsistency.label}</span>
                      ) : (
                        <span className="corner-chip">Tempo de volta: poucas voltas</span>
                      )}
                      {car.inputConsistency ? <ChannelBars channels={car.inputConsistency.channels} /> : <p className="comparison-note">Sem telemetria suficiente para os comandos.</p>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="race-debrief-chart-block">
                <span className="section-kicker">TRACK USAGE</span>
                <h4>Quanto da largura real da pista você usa, por carro e por trecho</h4>
                <p className="race-debrief-channels-note">Cada célula é 10% da volta, medida contra o traçado real da pista (OpenStreetMap): verde = perto do centro, vermelho = perto da borda tagueada/curva. Não é &quot;melhor&quot; sempre ser mais vermelho — é só onde cada carro te deixa confortável explorar a pista.</p>
                <div className="car-compare-cars-grid">
                  {data.cars.map((car) => (
                    <div className="car-compare-car-block" key={car.carId}>
                      <h5>{car.carName}</h5>
                      {car.trackUsageSegments ? <TrackUsageStrip segments={car.trackUsageSegments} /> : <p className="comparison-note">Sem traçado de pista.</p>}
                      {car.trackUsage && <p className="comparison-note">{car.trackUsage.avgPct.toFixed(0)}% médio • {car.trackUsage.maxPct.toFixed(0)}% no pico</p>}
                    </div>
                  ))}
                </div>
                {!!differences.length && (
                  <ul className="race-debrief-outlier-list">
                    {differences.map((item) => (
                      <li key={item.segment}>{item.segment * 10}%–{(item.segment + 1) * 10}% da volta: {item.maxCar} usa {item.maxPct.toFixed(0)}% da largura contra {item.minPct.toFixed(0)}% do {item.minCar} — {(item.spread).toFixed(0)}pp de diferença</li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
