"use client";

import { useEffect, useState } from "react";

type TrackOption = { trackId: number; trackName: string; trackVariant: string | null; carCount: number; carNames: string[] };
type ConsistencyStat = { stddev?: number; score?: number; label: string } | null;
type TrackUsage = { avgPct: number; maxPct: number } | null;
type CarStat = {
  carId: number; carName: string; lapsAnalyzed: number;
  bestLapSeconds: number; bestLapFormatted: string; deltaSeconds: number;
  lapTimeConsistency: ConsistencyStat; inputConsistency: ConsistencyStat; trackUsage: TrackUsage;
};
type ComparisonPayload = { status: string; track: { id: number; name: string; variant: string | null } | null; cars: CarStat[]; message?: string };

const CONSISTENCY_CLASS: Record<string, string> = { "muito consistente": "great", "consistente": "good", "variável": "warn", "muito inconsistente": "bad" };

/** Every bar in this view (best-lap delta, consistency, track usage) shares one horizontal-bar
 * layout -- easiest way to let the driver scan "which car wins" at a glance across three very
 * different units (seconds, a stddev ratio, a % of track width) without three different chart idioms. */
function CompareBar({ label, value, max, formatted, tone }: { label: string; value: number; max: number; formatted: string; tone?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="car-compare-row">
      <span className="car-compare-row-label">{label}</span>
      <div className="car-compare-row-track"><div className={`car-compare-row-fill ${tone ?? ""}`} style={{ width: `${pct}%` }} /></div>
      <span className="car-compare-row-value">{formatted}</span>
    </div>
  );
}

export default function CarComparison() {
  const [tracks, setTracks] = useState<TrackOption[] | null>(null);
  const [trackId, setTrackId] = useState<number | null>(null);
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
        if (result.tracks?.length) setTrackId(result.tracks[0].trackId);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingTracks(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (trackId === null) return;
    let active = true;
    setLoadingData(true);
    setError(null);
    fetch(`/api/telemetry/car-comparison?trackId=${trackId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao comparar carros");
        setData(result);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingData(false));
    return () => { active = false; };
  }, [trackId]);

  if (loadingTracks) return <div className="telemetry-state">Buscando pistas onde você testou mais de um carro...</div>;
  if (error) return <div className="telemetry-state error">{error}</div>;
  if (!tracks?.length) return <div className="telemetry-state">Nenhuma pista com voltas válidas de dois ou mais carros ainda. Isso aparece aqui assim que você tiver sessões de test drive ou practice com carros diferentes na mesma pista.</div>;

  const maxDelta = Math.max(0.05, ...(data?.cars.map((car) => car.deltaSeconds) ?? [0]));
  const maxLapStddev = Math.max(0.05, ...(data?.cars.map((car) => car.lapTimeConsistency?.stddev ?? 0) ?? [0]));
  const maxInputScore = Math.max(0.5, ...(data?.cars.map((car) => car.inputConsistency?.score ?? 0) ?? [0]));
  const maxTrackUsage = Math.max(10, ...(data?.cars.map((car) => car.trackUsage?.avgPct ?? 0) ?? [0]));

  return (
    <div className="car-comparison">
      <div className="car-compare-picker">
        <span className="section-kicker">COMPARAR CARROS NA MESMA PISTA</span>
        <select value={trackId ?? ""} onChange={(event) => setTrackId(Number(event.target.value))}>
          {tracks.map((track) => (
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

          <div className="race-debrief-chart-block">
            <span className="section-kicker">CONSISTÊNCIA</span>
            <h4>Tempo de volta e comandos, por carro</h4>
            <p className="race-debrief-channels-note">Desvio padrão do tempo de volta (menor = mais repetível) e um score combinado de acelerador/freio/volante (menor = você repete mais o mesmo movimento).</p>
            <div className="car-compare-block">
              {data.cars.map((car) => (
                <CompareBar key={car.carId} label={car.carName} value={car.lapTimeConsistency?.stddev ?? 0} max={maxLapStddev}
                  formatted={car.lapTimeConsistency ? `${(car.lapTimeConsistency.stddev ?? 0).toFixed(3)}s • ${car.lapTimeConsistency.label}` : "poucas voltas"}
                  tone={car.lapTimeConsistency ? CONSISTENCY_CLASS[car.lapTimeConsistency.label] : ""} />
              ))}
            </div>
            <div className="car-compare-block">
              {data.cars.map((car) => (
                <CompareBar key={car.carId} label={car.carName} value={car.inputConsistency?.score ?? 0} max={maxInputScore}
                  formatted={car.inputConsistency ? `${(car.inputConsistency.score ?? 0).toFixed(2)} • ${car.inputConsistency.label}` : "sem telemetria suficiente"}
                  tone={car.inputConsistency ? CONSISTENCY_CLASS[car.inputConsistency.label] : ""} />
              ))}
            </div>
          </div>

          <div className="race-debrief-chart-block">
            <span className="section-kicker">TRACK USAGE</span>
            <h4>Quanto da largura real da pista você usa, por carro</h4>
            <p className="race-debrief-channels-note">Medido contra o traçado real da pista (OpenStreetMap): 0% é sempre no centro, 100% é na borda tagueada. Não é "melhor" sempre ser maior — é só onde cada carro te deixa confortável explorar a pista.</p>
            <div className="car-compare-block">
              {data.cars.map((car) => (
                <CompareBar key={car.carId} label={car.carName} value={car.trackUsage?.avgPct ?? 0} max={maxTrackUsage}
                  formatted={car.trackUsage ? `${car.trackUsage.avgPct.toFixed(0)}% médio • ${car.trackUsage.maxPct.toFixed(0)}% no pico` : "sem traçado de pista"} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
