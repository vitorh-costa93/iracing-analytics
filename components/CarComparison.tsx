"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import TrackMap, { type TrackMapLine } from "@/components/TrackMap";

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
type SectorGps = { carId: number; points: { distance: number; lat: number; lon: number }[] };
type SectorConsistencyEntry = { carId: number; score: number | null; label: string | null };
type Sector = {
  segment: number; name: string | null; cornerNumber: number; startPct: number; endPct: number;
  winnerCarId: number | null; times: SectorTime[]; curves: SectorCurve[]; gps: SectorGps[]; consistency: SectorConsistencyEntry[];
};
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

/** Track map colored by which car was fastest through each corner (29/08/2026: "mostraria em cada
 * trecho qual carro foi mais rápido e isso que guiaria a coloração dos setores. Cada carro receberia
 * uma cor") -- same idea as SectorConsistency's own SectorTrackMap (components/SectorConsistency.tsx),
 * just colored by car identity instead of a consistency label. Kept compact (29/08/2026: "o mapa
 * está ocupando espaço demais") -- lives beside the ranking bars now, not its own full-width block. */
function SectorMap({ outline, sectors, cars }: { outline: TrackOutlinePoint[]; sectors: Sector[]; cars: CarStat[] }) {
  if (outline.length < 20) return null;
  const project = createTrackProjector(outline, 300, 220, 16);
  const colorByCarId = new Map(cars.map((car) => [car.carId, car.color]));
  return (
    <div className="sector-map-card compact">
      <svg viewBox="0 0 300 220" className="sector-map compact" role="img" aria-label="Mapa da pista colorido pelo carro mais rápido em cada curva">
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
    </div>
  );
}

/** One car's brake/throttle curve for one corner, in the app's standard channel colors (29/08/2026:
 * "mantendo o padrão de verde ser o acelerador e vermelho o freio") -- used two-up, side by side, one
 * per selected car, rather than overlaid by car color like the summary map above. */
function CornerInputChart({ curve }: { curve: SectorCurve | undefined }) {
  const width = 220, height = 90, pad = { left: 2, right: 2, gap: 4 };
  const rowHeight = (height - pad.gap) / 2;
  if (!curve) return <div className="corner-deep-chart-empty">sem telemetria</div>;
  const maxOffset = Math.max(1, ...[...curve.brake, ...curve.throttle].map((point) => point.offset));
  const x = (offset: number) => pad.left + (offset / maxOffset) * (width - pad.left - pad.right);
  const yInRow = (value: number, rowTop: number) => rowTop + (1 - Math.max(0, Math.min(1, value))) * rowHeight;
  const path = (points: CurvePoint[], rowTop: number) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.offset).toFixed(1)} ${yInRow(point.value, rowTop).toFixed(1)}`).join(" ");
  const brakeTop = 0, throttleTop = rowHeight + pad.gap;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="corner-deep-chart" role="img" aria-label="Freio e acelerador desse carro nessa curva">
      <text x={pad.left} y={brakeTop + 9} className="sector-curve-label">FREIO</text>
      <text x={pad.left} y={throttleTop + 9} className="sector-curve-label">ACEL</text>
      <path d={path(curve.brake, brakeTop)} className="corner-mini-line brake" />
      <path d={path(curve.throttle, throttleTop)} className="corner-mini-line throttle" />
    </svg>
  );
}

/** Real per-corner deep dive comparing exactly two cars at a time (29/08/2026: "esse comparativo eu
 * posso só selecionar dois carros para comparar... deixe os dois mais rápidos como default e no
 * drop-down list o restante"). Every detected real corner (not fixed %-of-lap bins, per "concordo, é
 * isso que eu realmente quero, setores reais") gets its own card: side-by-side input graphs (channel
 * colors, not per-car colors -- matches the rest of the app), consistency for both cars, and the
 * shared real-track components/TrackMap.tsx showing each car's actual GPS line through that corner --
 * the same real-boundary map style as "Melhor volta vs referência", now the standard everywhere. */
function CornerDeepDive({ sectors, cars, trackId, carAId, carBId }: { sectors: Sector[]; cars: CarStat[]; trackId: number | null; carAId: number; carBId: number }) {
  const carA = cars.find((car) => car.carId === carAId);
  const carB = cars.find((car) => car.carId === carBId);
  if (!carA || !carB) return null;
  return (
    <div className="corner-deep-grid">
      {sectors.map((sector) => {
        const curveA = sector.curves.find((curve) => curve.carId === carAId);
        const curveB = sector.curves.find((curve) => curve.carId === carBId);
        const gpsA = sector.gps.find((item) => item.carId === carAId);
        const gpsB = sector.gps.find((item) => item.carId === carBId);
        const timeA = sector.times.find((item) => item.carId === carAId);
        const timeB = sector.times.find((item) => item.carId === carBId);
        const consA = sector.consistency.find((item) => item.carId === carAId);
        const consB = sector.consistency.find((item) => item.carId === carBId);
        const lines: TrackMapLine[] = [];
        if (gpsA) lines.push({ points: gpsA.points, color: carA.color });
        if (gpsB) lines.push({ points: gpsB.points, color: carB.color, dashed: true });
        return (
          <div className="corner-deep-card" key={sector.segment}>
            <h5>{sector.name ?? `Curva ${sector.cornerNumber}`} <span>~{sector.startPct.toFixed(0)}% da volta</span></h5>
            <div className="corner-deep-body">
              <TrackMap trackId={trackId} lines={lines} width={220} height={150} className="corner-deep-map" />
              <div className="corner-deep-charts">
                <div>
                  <span className="corner-deep-car-label" style={{ color: carA.color }}>{carA.carName}</span>
                  <CornerInputChart curve={curveA} />
                </div>
                <div>
                  <span className="corner-deep-car-label" style={{ color: carB.color }}>{carB.carName}</span>
                  <CornerInputChart curve={curveB} />
                </div>
              </div>
            </div>
            <div className="corner-deep-meta">
              <span style={{ color: carA.color }}>{timeA ? `${timeA.seconds.toFixed(3)}s${timeA.deltaSeconds > 0 ? ` (+${timeA.deltaSeconds.toFixed(3)}s)` : ""}` : "—"}{consA?.label ? ` • ${consA.label}` : ""}</span>
              <span style={{ color: carB.color }}>{timeB ? `${timeB.seconds.toFixed(3)}s${timeB.deltaSeconds > 0 ? ` (+${timeB.deltaSeconds.toFixed(3)}s)` : ""}` : "—"}{consB?.label ? ` • ${consB.label}` : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
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
  // Deep-dive car pair -- "auto" tracks the two fastest cars by default, reset whenever the
  // comparison data changes; picking either dropdown pins that side manually.
  const [carA, setCarA] = useState<number | "auto">("auto");
  const [carB, setCarB] = useState<number | "auto">("auto");

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
    setCarA("auto");
    setCarB("auto");
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
  const resolvedCarA = carA === "auto" ? data?.cars[0]?.carId ?? null : carA;
  const resolvedCarB = carB === "auto" ? data?.cars[1]?.carId ?? null : carB;

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
              <div className="car-compare-row1">
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
                    <span className="section-kicker">MAIS RÁPIDO POR CURVA</span>
                    <h4>Quem manda em cada curva</h4>
                    <SectorMap outline={data.trackOutline} sectors={data.sectors} cars={data.cars} />
                  </div>
                )}
              </div>

              {!!data.sectors?.length && resolvedCarA !== null && resolvedCarB !== null && (
                <div className="race-debrief-chart-block">
                  <span className="section-kicker">DEEP-DIVE POR CURVA</span>
                  <h4>Curva por curva, freio/acelerador e traçado real</h4>
                  <p className="race-debrief-channels-note">Comparando dois carros por vez. {data.cars.length > 2 ? "Troque abaixo pra ver outro par." : ""}</p>
                  {data.cars.length > 2 && (
                    <div className="corner-deep-picker">
                      <select value={resolvedCarA} onChange={(event) => setCarA(Number(event.target.value))}>
                        {data.cars.filter((car) => car.carId !== resolvedCarB).map((car) => <option key={car.carId} value={car.carId}>{car.carName}</option>)}
                      </select>
                      <span>vs</span>
                      <select value={resolvedCarB} onChange={(event) => setCarB(Number(event.target.value))}>
                        {data.cars.filter((car) => car.carId !== resolvedCarA).map((car) => <option key={car.carId} value={car.carId}>{car.carName}</option>)}
                      </select>
                    </div>
                  )}
                  <CornerDeepDive sectors={data.sectors} cars={data.cars} trackId={data.track?.id ?? null} carAId={resolvedCarA} carBId={resolvedCarB} />
                </div>
              )}

              <div className="race-debrief-chart-block">
                <span className="section-kicker">CONSISTÊNCIA</span>
                <h4>Tempo de volta e comandos, por carro</h4>
                <p className="race-debrief-channels-note">Tempo de volta já sem sujeira (voltas anormalmente lentas descartadas antes do cálculo do desvio padrão). Detalhe por curva está no deep-dive acima.</p>
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
