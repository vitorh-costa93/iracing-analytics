"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";

type Category = "gt3" | "gtp";
const CATEGORIES: Category[] = ["gt3", "gtp"];
const CATEGORY_LABEL: Record<Category, string> = { gt3: "GT3", gtp: "GTP" };

type TrackOption = { trackId: number; trackName: string; trackVariant: string | null; carCount: number; carNames: string[] };
type SeasonOption = { seasonId: string; seasonName: string; lapCount: number; latestStartedAt: string };
type ListPayload = { status: string; seasons: SeasonOption[]; selectedSeasonId: string | null; tracks: TrackOption[] };
type ChannelConsistency = { channel: string; name: string; score: number; label: string };
type InputConsistency = { overall: { score: number; label: string }; channels: ChannelConsistency[] } | null;
type LapTimeConsistency = { stddev: number; label: string } | null;
type TrackUsage = { avgPct: number; maxPct: number } | null;
type CarStat = {
  carId: number; carName: string; color: string; lapsAnalyzed: number;
  bestLapSeconds: number; bestLapFormatted: string; deltaSeconds: number;
  lapTimeConsistency: LapTimeConsistency; inputConsistency: InputConsistency; trackUsage: TrackUsage;
  trackUsageSegments: (number | null)[] | null;
};
type CurvePoint = { offset: number; value: number };
type SectorTime = { carId: number; carName: string; seconds: number; deltaSeconds: number };
type SectorCurve = { carId: number; brake: CurvePoint[]; throttle: CurvePoint[] };
type Sector = { segment: number; startPct: number; endPct: number; winnerCarId: number | null; times: SectorTime[]; curves: SectorCurve[] };
type TrackOutlinePoint = { distance: number; lat: number; lon: number };
type ComparisonPayload = {
  status: string; track: { id: number; name: string; variant: string | null } | null;
  cars: CarStat[]; trackOutline?: TrackOutlinePoint[] | null; sectors?: Sector[]; message?: string;
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

/** Track map colored by which car was fastest through each segment (29/08/2026: "mostraria em cada
 * trecho qual carro foi mais rápido e isso que guiaria a coloração dos setores. Cada carro receberia
 * uma cor") -- same idea as SectorConsistency's own SectorTrackMap (components/SectorConsistency.tsx),
 * just colored by car identity instead of a consistency label. */
function SectorMap({ outline, sectors, cars }: { outline: TrackOutlinePoint[]; sectors: Sector[]; cars: CarStat[] }) {
  if (outline.length < 20) return null;
  const project = createTrackProjector(outline, 440, 300, 18);
  const colorByCarId = new Map(cars.map((car) => [car.carId, car.color]));
  const segmentCount = sectors.length;
  return (
    <div className="sector-map-card">
      <svg viewBox="0 0 440 300" className="sector-map" role="img" aria-label="Mapa da pista colorido pelo carro mais rápido em cada trecho">
        <polyline points={outline.map(project).join(" ")} className="sector-map-base" />
        {sectors.map((sector) => {
          const points = outline.filter((point) => point.distance >= sector.startPct && point.distance <= sector.endPct);
          const color = sector.winnerCarId !== null ? colorByCarId.get(sector.winnerCarId) : undefined;
          return points.length > 1 && color ? <polyline key={sector.segment} points={points.map(project).join(" ")} style={{ stroke: color }} className="sector-map-segment-colored" /> : null;
        })}
      </svg>
      <div className="sector-map-legend">
        {cars.map((car) => <span key={car.carId} style={{ color: car.color }}>{car.carName}</span>)}
      </div>
      <p className="comparison-note">{segmentCount} trechos de {(100 / segmentCount).toFixed(0)}% da volta cada, coloridos pelo carro mais rápido ali (volta mais rápida de cada carro).</p>
    </div>
  );
}

/** Every car's brake/throttle curve for one segment, overlaid and colored by car (29/08/2026:
 * "mostrar os gráficos de acelerador e freio também ajuda a entender a parte da consistência") --
 * one line per car per channel, not own-vs-reference like the other sub-tabs' corner charts. */
function SectorCurveChart({ curves, cars }: { curves: SectorCurve[]; cars: CarStat[] }) {
  const width = 320, height = 96, pad = { left: 4, right: 4, gap: 4 };
  const rowHeight = (height - pad.gap) / 2;
  const maxOffset = Math.max(1, ...curves.flatMap((curve) => [...curve.brake, ...curve.throttle].map((point) => point.offset)));
  const x = (offset: number) => pad.left + (offset / maxOffset) * (width - pad.left - pad.right);
  const yInRow = (value: number, rowTop: number) => rowTop + (1 - Math.max(0, Math.min(1, value))) * rowHeight;
  const path = (points: CurvePoint[], rowTop: number) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.offset).toFixed(1)} ${yInRow(point.value, rowTop).toFixed(1)}`).join(" ");
  const colorByCarId = new Map(cars.map((car) => [car.carId, car.color]));
  const brakeTop = 0, throttleTop = rowHeight + pad.gap;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sector-curve-chart" role="img" aria-label="Freio e acelerador de cada carro nesse trecho, sobrepostos">
      <text x={pad.left} y={brakeTop + 9} className="sector-curve-label">FREIO</text>
      <text x={pad.left} y={throttleTop + 9} className="sector-curve-label">ACEL</text>
      {curves.map((curve) => {
        const color = colorByCarId.get(curve.carId);
        if (!color) return null;
        return (
          <g key={curve.carId} style={{ stroke: color }}>
            <path d={path(curve.brake, brakeTop)} className="sector-curve-line" />
            <path d={path(curve.throttle, throttleTop)} className="sector-curve-line" />
          </g>
        );
      })}
    </svg>
  );
}

export default function CarComparison() {
  // Only GT3 and GTP are offered (29/08/2026: "Super Fórmula e LMP2 não se aplicam aqui porque não
  // tem diferença de carro") -- this driver only ever tests multiple distinct cars within these two.
  const [category, setCategory] = useState<Category>("gt3");
  // Season is now the PRIMARY filter (29/08/2026: "o filtro prioritário é o primeiro... depois
  // atualiza o filtro de pistas com o que eu preenchi primeiro" -- season used to be scoped to
  // whichever track was selected, which was backwards). "auto" lets the server pick the most recent
  // season with data for this category across every track (BoP changes between seasons); "all"
  // removes the season filter entirely; anything else is a specific season_id. Changing category
  // resets this back to "auto" since a different category has its own season coverage.
  const [season, setSeason] = useState<string>("auto");
  const [list, setList] = useState<ListPayload | null>(null);
  const [trackId, setTrackId] = useState<number | null>(null);
  const [data, setData] = useState<ComparisonPayload | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<number | null>(null);

  // Seasons list + track list, scoped by category and (once known) season -- refetched whenever
  // either changes. This drives both selects; the track list always reflects the currently chosen
  // season, never the other way around.
  useEffect(() => {
    let active = true;
    setLoadingList(true);
    setError(null);
    fetch(`/api/telemetry/car-comparison?category=${category}${season !== "auto" ? `&season=${season}` : ""}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: ListPayload) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error("Erro ao buscar temporadas/pistas");
        setList(result);
        if (season === "auto" && result.selectedSeasonId) setSeason(result.selectedSeasonId);
        setTrackId((current) => (current !== null && result.tracks.some((track) => track.trackId === current) ? current : result.tracks[0]?.trackId ?? null));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingList(false));
    return () => { active = false; };
  }, [category, season]);

  useEffect(() => {
    if (trackId === null) return;
    let active = true;
    setLoadingData(true);
    setError(null);
    setExpandedSector(null);
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

  if (loadingList && !list) return <div className="telemetry-state">Buscando temporadas e pistas onde você testou mais de um carro...</div>;
  if (error) return <div className="telemetry-state error">{error}</div>;

  // Bar width used to be scaled to the largest delta actually present, which made a genuinely tiny
  // gap (29/08/2026, driver-reported: "1 décimo" at Hockenheim rendering as an almost-full bar since
  // it happened to be the only/largest delta in a 2-car set) look enormous. Floor the "full bar"
  // reference at 3% of the reference lap time instead -- a real, sizeable gap on any track -- so a
  // 0.1-0.2s difference reads as the sliver it actually is; a genuinely large gap still fills the bar.
  const referenceLapSeconds = data?.cars[0]?.bestLapSeconds ?? 0;
  const maxDelta = Math.max(0.05, referenceLapSeconds * 0.03, ...(data?.cars.map((car) => car.deltaSeconds) ?? [0]));
  const differences = data?.cars.length ? biggestUsageDifferences(data.cars, Math.max(...data.cars.map((car) => car.trackUsageSegments?.length ?? 0))) : [];

  return (
    <div className="car-comparison">
      <div className="race-debrief-category-toggle">
        {CATEGORIES.map((item) => (
          <button key={item} className={category === item ? "active" : ""} onClick={() => { setCategory(item); setSeason("auto"); }}>{CATEGORY_LABEL[item]}</button>
        ))}
      </div>

      {!list?.tracks.length ? (
        <div className="telemetry-state">Nenhuma pista com voltas válidas de dois ou mais carros de {CATEGORY_LABEL[category]} ainda{season !== "all" ? " nessa temporada" : ""}. {season !== "all" && <button type="button" className="retry-button" onClick={() => setSeason("all")}>Ver todas as temporadas</button>}</div>
      ) : (
        <>
          <div className="car-compare-picker">
            <span className="section-kicker">COMPARAR CARROS NA MESMA PISTA</span>
            {!!list?.seasons.length && (
              <>
                <select value={season === "auto" ? list.selectedSeasonId ?? "all" : season} onChange={(event) => setSeason(event.target.value)}>
                  <option value="all">Todas as temporadas</option>
                  {list.seasons.map((item) => <option key={item.seasonId} value={item.seasonId}>{item.seasonName}</option>)}
                </select>
                <p className="comparison-note">BoP muda entre temporadas — por padrão só a mais recente com dados entra na comparação. Troque acima se quiser ver outra ou juntar todas.</p>
              </>
            )}
            <select value={trackId ?? ""} onChange={(event) => setTrackId(Number(event.target.value))}>
              {list.tracks.map((track) => (
                <option key={track.trackId} value={track.trackId}>{track.trackName}{track.trackVariant ? ` (${track.trackVariant})` : ""} — {track.carCount} carros</option>
              ))}
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

              {!!data.trackOutline && !!data.sectors?.length && (
                <div className="race-debrief-chart-block">
                  <span className="section-kicker">MAIS RÁPIDO POR TRECHO</span>
                  <h4>Quem manda em cada pedaço da pista</h4>
                  <p className="race-debrief-channels-note">Cada trecho é comparado pela volta mais rápida de cada carro (tempo real, por integração de velocidade). Clique num trecho pra ver freio/acelerador de cada carro sobrepostos ali.</p>
                  <SectorMap outline={data.trackOutline} sectors={data.sectors} cars={data.cars} />
                  <div className="sector-list">
                    {data.sectors.map((sector) => (
                      <div key={sector.segment} className="sector-list-row">
                        <button type="button" className="sector-list-toggle" onClick={() => setExpandedSector(expandedSector === sector.segment ? null : sector.segment)}>
                          <span>{sector.startPct.toFixed(0)}%–{sector.endPct.toFixed(0)}%</span>
                          {sector.times.map((time, index) => (
                            <span key={time.carId} style={{ color: data!.cars.find((car) => car.carId === time.carId)?.color }}>
                              {index === 0 ? time.carName : `${time.carName} +${time.deltaSeconds.toFixed(2)}s`}
                            </span>
                          ))}
                        </button>
                        {expandedSector === sector.segment && <SectorCurveChart curves={sector.curves} cars={data!.cars} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="race-debrief-chart-block">
                <span className="section-kicker">CONSISTÊNCIA</span>
                <h4>Tempo de volta e comandos, por carro</h4>
                <p className="race-debrief-channels-note">Tempo de volta já sem sujeira (voltas anormalmente lentas descartadas antes do cálculo do desvio padrão). Detalhe por trecho está na seção acima.</p>
                <div className="car-compare-block">
                  {data.cars.map((car) => (
                    <div className="car-compare-row" key={car.carId}>
                      <span className="car-compare-row-label" style={{ color: car.color }}>{car.carName}</span>
                      {car.lapTimeConsistency ? (
                        <span className={`corner-chip ${CONSISTENCY_CLASS[car.lapTimeConsistency.label] ?? ""}`}>{car.lapTimeConsistency.stddev.toFixed(3)}s • {car.lapTimeConsistency.label}</span>
                      ) : <span className="corner-chip">poucas voltas</span>}
                      {car.inputConsistency && <span className={`corner-chip ${CONSISTENCY_CLASS[car.inputConsistency.overall.label] ?? ""}`}>comandos: {car.inputConsistency.overall.label}</span>}
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
                      <h5 style={{ color: car.color }}>{car.carName}</h5>
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
