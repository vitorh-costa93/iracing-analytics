"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { CarBrandIcon } from "@/lib/car-brand";
import TrackMap, { type TrackMapLine, type TrackMapMarker } from "@/components/TrackMap";
import FocusedGaugeChart, { type FocusedSide } from "@/components/FocusedGaugeChart";

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
type LapConditions = {
  trackTempC: number | null; trackWetness: number | null; trackUsagePct: number | null;
  airTempC: number | null; relativeHumidityPct: number | null; windSpeedKmh: number | null;
  precipitationPct: number | null; cloudsLabel: string | null;
} | null;
type TractionEvents = {
  lapsAnalyzed: number; wheelspinCount: number; correctionCount: number;
  wheelspinPer10Laps: number; correctionsPer10Laps: number;
  worstWheelspin: { distance: number; speedKmh: number; gear: number; throttlePct: number; rpmSurplusPct: number } | null;
  worstCorrection: { startDistance: number; endDistance: number; oscillationDeg: number; baselineDeg: number; speedKmh: number } | null;
};
type CarStat = {
  carId: number; carName: string; color: string; lapsAnalyzed: number;
  bestLapSeconds: number; bestLapFormatted: string; deltaSeconds: number;
  lapTimeConsistency: LapTimeConsistency; inputConsistency: InputConsistency; trackUsage: TrackUsage;
  trackUsageSegments: (number | null)[] | null; conditions: LapConditions; tractionEvents: TractionEvents;
};
type CurvePoint = { offset: number; value: number };
type SectorTime = { carId: number; carName: string; seconds: number; deltaSeconds: number };
type SectorCurve = { carId: number; brake: CurvePoint[]; throttle: CurvePoint[]; speed: CurvePoint[]; steering: CurvePoint[]; gear: CurvePoint[] };
type SectorGps = { carId: number; points: { distance: number; lat: number; lon: number }[] };
type SectorConsistencyEntry = { carId: number; score: number | null; label: string | null };
type SectorTrackUsageEntry = { carId: number; avgPct: number | null };
type Sector = {
  segment: number; name: string | null; cornerNumber: number; startPct: number; endPct: number;
  winnerCarId: number | null; times: SectorTime[]; curves: SectorCurve[]; gps: SectorGps[]; consistency: SectorConsistencyEntry[];
  trackUsage: SectorTrackUsageEntry[];
};
type MapSegment = { startPct: number; endPct: number; winnerCarId: number | null };
type TrackOutlinePoint = { distance: number; lat: number; lon: number };
type ComparisonPayload = {
  status: string; track: { id: number; name: string; variant: string | null } | null;
  cars: CarStat[]; trackOutline?: TrackOutlinePoint[] | null; sectors?: Sector[]; mapSegments?: MapSegment[]; narrative?: string | null; message?: string;
  conditionsNote?: string | null;
};

/** Used only for the best-lap ranking now (29/08/2026: "gráfico de barras horizontais, só manter
 * para o ranking por carro") -- consistency and track usage below reuse other sub-tabs' own visual
 * styles instead of this. 31/08/2026: manufacturer icon + full (untruncated) car name, matching the
 * Overview ranking list's own treatment ("gostaria... fossem usados os símbolos como está... também
 * quero que o nome todo apareça por extenso, depois vem a barrinha com o tempo") -- name+icon on
 * their own line since a full name like "McLaren 720S GT3 EVO" doesn't fit a fixed label column
 * alongside a bar and a time value without truncating one of them. */
// 11/09/2026: "na parte de Comparar Carros serviria para dar mais credibilidade se eu preciso corrigir
// menos o volante com um carro do que com outro" -- only shows a rate when it's actually notable
// (same NOTABLE_RATE_PER_10_LAPS=2 threshold as lib/traction-narrative.ts server-side), so a car with
// a clean traction record just shows nothing here instead of "0.0x/10 voltas" clutter on every row.
// 11/09/2026 fix: "não consegui entender esses comentários, até porque eu nem dei 10 voltas, foram
// sempre 5" -- the rate IS a real normalized "per 10 laps" projection (needed so a car sampled on 1
// lap and one sampled on 5 are comparable), but showing ONLY the projected number reads as if exactly
// 10 laps were driven. Appending the real "(N em M voltas)" count ties the projection back to the
// actual sample so it can't be misread as a literal 10-lap tally.
const NOTABLE_TRACTION_RATE = 2;
function formatTractionInline(events: TractionEvents): string | null {
  const parts: string[] = [];
  if (events.wheelspinPer10Laps >= NOTABLE_TRACTION_RATE) parts.push(`destraciona ${events.wheelspinPer10Laps.toFixed(1)}x/10 voltas (${events.wheelspinCount} em ${events.lapsAnalyzed})`);
  if (events.correctionsPer10Laps >= NOTABLE_TRACTION_RATE) parts.push(`corrige o volante ${events.correctionsPer10Laps.toFixed(1)}x/10 voltas (${events.correctionCount} em ${events.lapsAnalyzed})`);
  return parts.length ? parts.join(" • ") : null;
}

function CompareBar({ label, value, max, formatted, conditions, tractionEvents }: { label: string; value: number; max: number; formatted: string; conditions?: LapConditions; tractionEvents?: TractionEvents }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  const conditionsText = formatConditionsInline(conditions);
  const tractionText = tractionEvents ? formatTractionInline(tractionEvents) : null;
  return (
    <div className="car-compare-row">
      <span className="car-compare-row-name">
        <CarBrandIcon name={label} />{label}
        {conditionsText && <span className="car-compare-row-cond"> ({conditionsText})</span>}
      </span>
      {tractionText && <span className="car-compare-row-traction">{tractionText}</span>}
      <div className="car-compare-row-track"><div className="car-compare-row-fill" style={{ width: `${pct}%` }} /></div>
      <span className="car-compare-row-value">{formatted}</span>
    </div>
  );
}

/** Track map colored by which car was fastest through each fixed %-of-lap segment (29/08/2026:
 * "eu ainda quero a coloração da pista por setor, não por curva" -- real corners left long gray gaps
 * on every straight, since nothing gets "detected" as turning there; fixed segments give full, even
 * coverage). Same idea as SectorConsistency's own SectorTrackMap (components/SectorConsistency.tsx),
 * just colored by car identity instead of a consistency label. Kept compact (29/08/2026: "o mapa
 * está ocupando espaço demais") -- lives beside the ranking bars now, not its own full-width block. */
function SectorMap({ outline, mapSegments, cars }: { outline: TrackOutlinePoint[]; mapSegments: MapSegment[]; cars: CarStat[] }) {
  if (outline.length < 20) return null;
  const project = createTrackProjector(outline, 300, 220, 16);
  const colorByCarId = new Map(cars.map((car) => [car.carId, car.color]));
  return (
    <div className="sector-map-card compact">
      <svg viewBox="0 0 300 220" className="sector-map compact" role="img" aria-label="Mapa da pista colorido pelo carro mais rápido em cada trecho">
        <polyline points={outline.map(project).join(" ")} className="sector-map-base" />
        {mapSegments.map((segment, index) => {
          const points = outline.filter((point) => point.distance >= segment.startPct && point.distance <= segment.endPct);
          const color = segment.winnerCarId !== null ? colorByCarId.get(segment.winnerCarId) : undefined;
          return points.length > 1 && color ? <polyline key={index} points={points.map(project).join(" ")} style={{ stroke: color }} className="sector-map-segment-colored" /> : null;
        })}
      </svg>
      <div className="sector-map-legend">
        {cars.map((car) => <span key={car.carId} style={{ color: car.color }}>{car.carName}</span>)}
      </div>
    </div>
  );
}

/** Computed client-side (not server-side) since it depends on whichever 2 cars are currently
 * selected in the deep-dive picker, which the server doesn't know about. Analysis tone, not advice
 * tone (29/08/2026: "com um tom mais de análise de performance dos carros, não tanto de conselho
 * para melhorar") -- this is characterizing how the two CARS differ, not coaching the driver.
 * 31/08/2026: folds in what used to be the standalone CONSISTÊNCIA/TRACK USAGE sections ("em total
 * desuso... a ideia é incorporar elas dentro da análise do deep-dive por curva, para ter algo mais
 * rico ali") -- input consistency and track-width usage now read as one combined sentence here
 * instead of their own blocks below the deep-dive, e.g. "Ford Mustang é mais rápido, mas a retomada
 * do acelerador com a Mclaren foi mais consistente... com um uso melhor da pista." */
function cornerNarrative(sector: Sector, carA: CarStat, carB: CarStat): string {
  const timeA = sector.times.find((item) => item.carId === carA.carId);
  const timeB = sector.times.find((item) => item.carId === carB.carId);
  if (!timeA || !timeB) return "Sem dado suficiente dos dois carros nessa curva.";
  const diff = Math.abs(timeA.seconds - timeB.seconds);
  const faster = timeA.seconds <= timeB.seconds ? carA : carB;
  const slower = faster.carId === carA.carId ? carB : carA;
  let text = diff < 0.01
    ? `Praticamente empatados aqui — ${diff.toFixed(3)}s de diferença entre ${carA.carName} e ${carB.carName}.`
    : `${faster.carName} é ${diff.toFixed(3)}s mais rápido que ${slower.carName} nessa curva.`;

  const consA = sector.consistency.find((item) => item.carId === carA.carId);
  const consB = sector.consistency.find((item) => item.carId === carB.carId);
  const moreConsistent = consA?.label && consB?.label && consA.label !== consB.label
    ? ((consA.score ?? Infinity) < (consB.score ?? Infinity) ? carA : carB)
    : null;
  const moreConsistentLabel = moreConsistent
    ? (moreConsistent.carId === carA.carId ? consA?.label : consB?.label)
    : null;

  const usageA = sector.trackUsage.find((item) => item.carId === carA.carId)?.avgPct ?? null;
  const usageB = sector.trackUsage.find((item) => item.carId === carB.carId)?.avgPct ?? null;
  const usageDiff = usageA !== null && usageB !== null ? usageA - usageB : null;
  // 8pp threshold -- small enough to catch a real difference, large enough to not read noise as signal.
  const widerUsage = usageDiff !== null && Math.abs(usageDiff) >= 8 ? (usageDiff > 0 ? carA : carB) : null;

  if (moreConsistent && moreConsistentLabel && widerUsage && widerUsage.carId === moreConsistent.carId) {
    text += ` A retomada de acelerador/freio com ${moreConsistent.carName} foi mais consistente aqui (${moreConsistentLabel}), com um uso melhor da pista.`;
  } else if (moreConsistent && moreConsistentLabel) {
    text += ` ${moreConsistent.carName} repete mais o movimento aqui (${moreConsistentLabel}).`;
  } else if (widerUsage) {
    text += ` ${widerUsage.carName} usa mais da largura da pista nessa curva.`;
  }
  return text;
}

// --- Corner focused-chart popup (29/08/2026: "ao clicar em cada curva, tenho o mesmo gráfico
// disponível... a diferença é que serão dois gráficos, mas mexer em um, faz a bolinha na pista se
// movimentar para os dois carros") -- now built on the SAME shared components/FocusedGaugeChart.tsx
// widget as ActiveWeekTelemetry.tsx's own popup (31/08/2026: "Eu quero, inclusive, que use o mesmo
// objeto"), generalized from own/reference to two arbitrary cars. See that shared component's own
// top comment for the column order (inputs -> accel bar -> brake bar -> gear -> speed -> wheel) and
// coloring rules (wheel/gear/bars stay neutral; only the line style and the label under the wheel
// carry each car's own color).
function interpolateCurve(curve: CurvePoint[] | undefined, offset: number): number | null {
  if (!curve || !curve.length) return null;
  let previous = curve[0];
  for (const point of curve) {
    if (point.offset >= offset) {
      const span = point.offset - previous.offset;
      const ratio = span > 0 ? (offset - previous.offset) / span : 0;
      return previous.value + (point.value - previous.value) * ratio;
    }
    previous = point;
  }
  return previous.value;
}

function CornerFocusedChart({ curveA, curveB, carAName, carBName, colorA, colorB, hoverOffset, onHover }: {
  curveA: SectorCurve | undefined; curveB: SectorCurve | undefined; carAName: string; carBName: string; colorA: string; colorB: string;
  hoverOffset: number | null; onHover: (offset: number | null) => void;
}) {
  const maxOffset = Math.max(1, ...[curveA, curveB].flatMap((curve) => curve ? [...curve.brake, ...curve.throttle, ...curve.speed].map((point) => point.offset) : [0]));
  const wheelOffset = hoverOffset ?? maxOffset / 2;
  const toSeries = (curve: CurvePoint[] | undefined) => (curve ?? []).map((point) => ({ x: point.offset, value: point.value }));
  const sides: FocusedSide[] = [
    {
      key: "a", label: carAName, color: colorA, dashed: false,
      throttle: toSeries(curveA?.throttle), brake: toSeries(curveA?.brake),
      angleRad: interpolateCurve(curveA?.steering, wheelOffset), gear: interpolateCurve(curveA?.gear, wheelOffset),
      speedMs: interpolateCurve(curveA?.speed, wheelOffset),
      throttleNow: interpolateCurve(curveA?.throttle, wheelOffset), brakeNow: interpolateCurve(curveA?.brake, wheelOffset),
    },
    {
      key: "b", label: carBName, color: colorB, dashed: true,
      throttle: toSeries(curveB?.throttle), brake: toSeries(curveB?.brake),
      angleRad: interpolateCurve(curveB?.steering, wheelOffset), gear: interpolateCurve(curveB?.gear, wheelOffset),
      speedMs: interpolateCurve(curveB?.speed, wheelOffset),
      throttleNow: interpolateCurve(curveB?.throttle, wheelOffset), brakeNow: interpolateCurve(curveB?.brake, wheelOffset),
    },
  ];
  return (
    <FocusedGaugeChart sides={sides} xDomain={[0, maxOffset]} hoverX={hoverOffset} onHoverX={onHover}
      ariaLabel="Freio, acelerador, marcha, velocidade e volante dos dois carros nessa curva; passe o mouse para ver a posição no mapa" />
  );
}

/** Interpolates lat/lon at a given corner offset for the hover marker (29/08/2026: "faz a bolinha
 * na pista se movimentar para os dois carros") -- sector.gps points are keyed by absolute lap
 * distance, not corner-relative offset, so this needs the corner's own startPct to convert. */
function interpolateGps(points: { distance: number; lat: number; lon: number }[], absoluteDistance: number): { lat: number; lon: number } | null {
  if (!points.length) return null;
  let previous = points[0];
  for (const point of points) {
    if (point.distance >= absoluteDistance) {
      const span = point.distance - previous.distance;
      const ratio = span > 0 ? (absoluteDistance - previous.distance) / span : 0;
      return { lat: previous.lat + (point.lat - previous.lat) * ratio, lon: previous.lon + (point.lon - previous.lon) * ratio };
    }
    previous = point;
  }
  return { lat: previous.lat, lon: previous.lon };
}

/** Opened by clicking a corner card's title (29/08/2026: "ao clicar em cada curva, tenho o mesmo
 * gráfico disponível para analisar e da mesma forma [como Melhor volta vs referência]"). Hovering
 * the chart drives one marker per car on the same real track map, moving together. */
function CornerFocusedPopup({ sector, carA, carB, trackId, onClose, sectors, onNavigate }: { sector: Sector; carA: CarStat; carB: CarStat; trackId: number | null; onClose: () => void; sectors?: Sector[]; onNavigate?: (sector: Sector) => void }) {
  const [hoverOffset, setHoverOffset] = useState<number | null>(null);
  // 02/09/2026 persona fix: "Esc, rolar, achar o card certo, clicar. Seis vezes numa aba, vinte em
  // Comparar Carros" -- Left/Right cycle through the same deep-dive list without closing the popup.
  const list = sectors ?? [];
  const index = list.findIndex((item) => item.segment === sector.segment);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && onNavigate && index < list.length - 1) { event.preventDefault(); onNavigate(list[index + 1]); }
      else if (event.key === "ArrowLeft" && onNavigate && index > 0) { event.preventDefault(); onNavigate(list[index - 1]); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onNavigate, list, index]);

  const curveA = sector.curves.find((curve) => curve.carId === carA.carId);
  const curveB = sector.curves.find((curve) => curve.carId === carB.carId);
  const gpsA = sector.gps.find((item) => item.carId === carA.carId);
  const gpsB = sector.gps.find((item) => item.carId === carB.carId);
  const lines: TrackMapLine[] = [];
  if (gpsA) lines.push({ points: gpsA.points, color: carA.color });
  if (gpsB) lines.push({ points: gpsB.points, color: carB.color, dashed: true });
  const absoluteDistance = sector.startPct + (hoverOffset ?? (sector.endPct - sector.startPct) / 2);
  const markers: TrackMapMarker[] = [];
  if (gpsA) { const point = interpolateGps(gpsA.points, absoluteDistance); if (point) markers.push({ ...point, color: carA.color }); }
  if (gpsB) { const point = interpolateGps(gpsB.points, absoluteDistance); if (point) markers.push({ ...point, color: carB.color }); }

  return (
    <div className="insight-popup-backdrop" onClick={onClose}>
      <div className="insight-popup" onClick={(event) => event.stopPropagation()}>
        <div className="insight-popup-head">
          <div>
            <span className="section-kicker">{(sector.name ?? `CURVA ${sector.cornerNumber}`).toUpperCase()}</span>
            <h3 style={{ color: carA.color }}>{carA.carName} <span style={{ color: "var(--muted)" }}>vs</span> <span style={{ color: carB.color }}>{carB.carName}</span></h3>
          </div>
          {onNavigate && list.length > 1 && (
            <div className="insight-popup-nav">
              <button type="button" className="insight-popup-step" disabled={index <= 0} onClick={() => onNavigate(list[index - 1])} aria-label="Curva anterior">← Anterior</button>
              <button type="button" className="insight-popup-step" disabled={index === -1 || index >= list.length - 1} onClick={() => onNavigate(list[index + 1])} aria-label="Próxima curva">Próxima →</button>
            </div>
          )}
          <button type="button" className="insight-popup-close" onClick={onClose}>Fechar ✕</button>
        </div>
        <div className="insight-popup-body">
          <CornerFocusedChart curveA={curveA} curveB={curveB} carAName={carA.carName} carBName={carB.carName} colorA={carA.color} colorB={carB.color} hoverOffset={hoverOffset} onHover={setHoverOffset} />
          <div className="insight-popup-map">
            <span className="section-kicker">TRAÇADO</span>
            {/* Default width/height/className (31/08/2026: "os gráficos têm que ser do mesmo tamanho
             * dos da imagem 1") -- same .insight-popup-map .track-map sizing ActiveWeekTelemetry's
             * own popup map already uses, instead of a smaller fixed-pixel override. */}
            <TrackMap trackId={trackId} lines={lines} markers={markers} />
            <p className="track-map-legend"><span style={{ color: carA.color }}>{carA.carName}</span><span style={{ color: carB.color }}>{carB.carName}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Real per-corner deep dive comparing exactly two cars at a time (29/08/2026: "esse comparativo eu
 * posso só selecionar dois carros para comparar... deixe os dois mais rápidos como default e no
 * drop-down list o restante"). Every detected real corner (not fixed %-of-lap bins, per "concordo, é
 * isso que eu realmente quero, setores reais") gets its own card: title, narrative, and the time/
 * consistency line. The input graphs and real track map only render inside the focused popup now
 * (31/08/2026: "Deep-dive por curva eu quero exatamente da mesma forma que temos na seção de Melhor
 * Volta vs. Referência, os inputs e o traçado só aparecem quando eu clico em cada curva") -- clicking
 * the title (or anywhere on the card) opens CornerFocusedPopup for the full detail. */
function CornerDeepDive({ sectors, cars, carAId, carBId, onOpenSector }: { sectors: Sector[]; cars: CarStat[]; carAId: number; carBId: number; onOpenSector: (sector: Sector) => void }) {
  const carA = cars.find((car) => car.carId === carAId);
  const carB = cars.find((car) => car.carId === carBId);
  if (!carA || !carB) return null;
  return (
    <div className="corner-deep-grid">
      {sectors.map((sector) => {
        const timeA = sector.times.find((item) => item.carId === carAId);
        const timeB = sector.times.find((item) => item.carId === carBId);
        const consA = sector.consistency.find((item) => item.carId === carAId);
        const consB = sector.consistency.find((item) => item.carId === carBId);
        return (
          <button type="button" className="corner-deep-card corner-deep-card-open" key={sector.segment} onClick={() => onOpenSector(sector)}>
            <h5>{sector.name ?? `Curva ${sector.cornerNumber}`} <span>~{sector.startPct.toFixed(0)}% da volta</span></h5>
            <p className="corner-deep-narrative">{cornerNarrative(sector, carA, carB)}</p>
            <div className="corner-deep-meta">
              <span style={{ color: carA.color }}>{timeA ? `${timeA.seconds.toFixed(3)}s${timeA.deltaSeconds > 0 ? ` (+${timeA.deltaSeconds.toFixed(3)}s)` : ""}` : "—"}{consA?.label ? ` • ${consA.label}` : ""}</span>
              <span style={{ color: carB.color }}>{timeB ? `${timeB.seconds.toFixed(3)}s${timeB.deltaSeconds > 0 ? ` (+${timeB.deltaSeconds.toFixed(3)}s)` : ""}` : "—"}{consB?.label ? ` • ${consB.label}` : ""}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** "elas podem vir no gráfico de Melhor Volta, como informação adicional ao lado do nome de cada
 * carro" (10/09/2026) -- track state for a car's fastest lap, shown inline next to the car name in
 * the ranking instead of its own section. Kept to the two the driver named (track temp + rubber);
 * the fuller weather read and the cross-car divergence warning (conditionsNote) still come from the
 * server. Garage61 weather is per session, taken from each car's own fastest lap -- see
 * route.ts's extractConditions comment. */
function formatConditionsInline(conditions?: LapConditions): string | null {
  if (!conditions) return null;
  const parts: string[] = [];
  if (conditions.trackTempC !== null) parts.push(`temp. da pista: ${conditions.trackTempC.toFixed(1)}°C`);
  if (conditions.trackWetness !== null && conditions.trackWetness > 0) parts.push(`pista molhada (nível ${conditions.trackWetness})`);
  if (conditions.trackUsagePct !== null) parts.push(`borracha na pista: ${conditions.trackUsagePct.toFixed(0)}%`);
  return parts.length ? parts.join(" | ") : null;
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
  const [focusedSector, setFocusedSector] = useState<Sector | null>(null);

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
    setFocusedSector(null);
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
                <div className="car-compare-row1-left">
                  <div className="race-debrief-chart-block">
                    <span className="section-kicker">MELHOR VOLTA</span>
                    <h4>Ranking por carro — {data.track?.name}{data.track?.variant ? ` (${data.track.variant})` : ""}</h4>
                    <p className="race-debrief-channels-note">O primeiro é a volta mais rápida entre todos os carros nessa pista; os demais mostram a diferença para ela.</p>
                    <div className="car-compare-block">
                      {data.cars.map((car) => (
                        <CompareBar key={car.carId} label={car.carName} value={car.deltaSeconds || maxDelta * 0.02} max={maxDelta}
                          formatted={car.deltaSeconds === 0 ? `${car.bestLapFormatted} (referência)` : `+${car.deltaSeconds.toFixed(3)}s`}
                          conditions={car.conditions} tractionEvents={car.tractionEvents} />
                      ))}
                    </div>
                    {data.conditionsNote && <p className="comparison-note comparison-note-warning">{data.conditionsNote}</p>}
                  </div>
                  {/* Engineer-style read of the numbers above, not a restatement of them (29/08/2026:
                   * "quero que ali seja de fato um engenheiro me aconselhando, enxergar os white
                   * spaces que eu não estou vendo") -- the fastest car by lap time isn't automatically
                   * the one worth racing; this surfaces where a slower car is actually more
                   * consistent, wins more real corners, or lets him use more of the track. Its own
                   * block now (31/08/2026: "o gráfico de delta de tempo e o texto com o insight podiam
                   * dividir toda a altura, sendo cada um ocupando metade da altura do mapa") so it
                   * fills the bottom half of the row instead of trailing right after the bars with a
                   * big empty gap below it next to the taller map. */}
                  <div className="race-debrief-chart-block car-compare-insight-block">
                    <span className="section-kicker">INSIGHT DO ENGENHEIRO</span>
                    <p className="car-compare-narrative">{data.narrative ?? "Sem insight suficiente ainda para esse conjunto de carros."}</p>
                  </div>
                </div>
                {!!data.trackOutline && !!data.mapSegments?.length && (
                  <div className="race-debrief-chart-block">
                    <span className="section-kicker">MAIS RÁPIDO POR TRECHO</span>
                    <h4>Quem manda em cada pedaço da pista</h4>
                    <SectorMap outline={data.trackOutline} mapSegments={data.mapSegments} cars={data.cars} />
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
                  <CornerDeepDive sectors={data.sectors} cars={data.cars} carAId={resolvedCarA} carBId={resolvedCarB} onOpenSector={setFocusedSector} />
                </div>
              )}

              {focusedSector && (() => {
                const carA2 = data.cars.find((car) => car.carId === resolvedCarA);
                const carB2 = data.cars.find((car) => car.carId === resolvedCarB);
                return carA2 && carB2 ? (
                  <CornerFocusedPopup sector={focusedSector} carA={carA2} carB={carB2} trackId={data.track?.id ?? null} onClose={() => setFocusedSector(null)} sectors={data.sectors} onNavigate={setFocusedSector} />
                ) : null;
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}
