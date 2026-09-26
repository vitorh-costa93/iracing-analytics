"use client";

import { useMemo, useState, type MouseEvent, type TouchEvent } from "react";
import LapMap from "@/components/telemetry/LapMap";
import { wrapDistance } from "@/lib/corner-sequences";
import type { BestPass } from "@/lib/debrief-best-pass";
import type { Trace, TracePoint } from "@/lib/telemetry-trace";

/**
 * Melhor passagem de um trecho no Race Debrief (auditoria B7, 26/09/2026): mapa local do trecho e as
 * curvas de freio e acelerador da sua passagem mais rápida por ali. Volta o que a versão anterior
 * mostrava por curva (94c4d8d:components/RaceDebrief.tsx, "Melhor freada" + CornerTrackMap), agora
 * dentro da linha do trecho e com o mapa Night Grid (LapMap: contorno real, zoom e pan). Passar o
 * mouse no gráfico move a bolinha no mapa.
 */
const W = 480, H = 132, PAD_L = 8, PAD_R = 8, PAD_T = 18, PAD_B = 8;

function decimal(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}

const NULLS = { rpm: null, gear: null, clutch: null, steering: null, latAccel: null, longAccel: null, yaw: null, yawRate: null, abs: null, drs: null, pushToPass: null, p2pStatus: null, p2pCount: null };

export default function BestPassDetail({ pass, label, trackId }: { pass: BestPass; label: string; trackId: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const first = pass.points[0]?.d ?? 0;
  const last = pass.points[pass.points.length - 1]?.d ?? 1;
  const span = Math.max(0.01, last - first);
  const x = (d: number) => PAD_L + ((d - first) / span) * (W - PAD_L - PAD_R);
  const y = (value: number) => PAD_T + (1 - Math.max(0, Math.min(1, value))) * (H - PAD_T - PAD_B);

  const trace: Trace = useMemo(() => ({
    points: pass.points.map((point): TracePoint => ({ ...NULLS, distance: wrapDistance(point.d), lat: point.lat, lon: point.lon, speed: point.speed, brake: point.brake, throttle: point.throttle })),
    channels: [],
    trackLengthMeters: null,
  }), [pass]);

  const line = (field: "brake" | "throttle") => pass.points
    .filter((point) => point[field] !== null)
    .map((point) => `${x(point.d).toFixed(1)},${y(point[field] as number).toFixed(1)}`)
    .join(" ");

  function toD(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    return Math.max(first, Math.min(last, first + ((px - PAD_L) / (W - PAD_L - PAD_R)) * span));
  }
  const onMove = (event: MouseEvent<SVGSVGElement>) => setHover(toD(event.clientX, event.currentTarget));
  const onTouch = (event: TouchEvent<SVGSVGElement>) => { if (event.touches[0]) setHover(toD(event.touches[0].clientX, event.currentTarget)); };

  const gain = pass.gainVsAverage;
  return (
    <div className="ngr-best" role="group" aria-label={`Melhor passagem em ${label}`}>
      <div className="ngr-best-text">
        <div className="ngr-best-title">Sua melhor passagem aqui</div>
        <p>
          {pass.lapNumber !== null ? `Volta ${pass.lapNumber}` : "Uma das voltas"}
          {gain >= 0.005 ? `: ${decimal(gain, 2)} s mais rápida que a sua média neste trecho (${pass.passes} passagens).` : `: praticamente igual à sua média neste trecho (${pass.passes} passagens).`}
          {" "}É o seu próprio jeito de fazer, não uma referência de fora: veja onde você freou e quando voltou ao acelerador.
        </p>
        <div className="ngr-best-legend"><span><i data-line="brake" />Freio</span><span><i data-line="throttle" />Acelerador</span></div>
      </div>
      <svg className="ngr-best-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Freio e acelerador da volta ${pass.lapNumber ?? ""} em ${label}; passe o mouse para localizar no mapa`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onTouch} onTouchMove={onTouch} onTouchEnd={() => setHover(null)}>
        <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} className="ngt-grid-line" />
        <line x1={PAD_L} x2={W - PAD_R} y1={y(1)} y2={y(1)} className="ngt-grid-line" />
        <text x={PAD_L} y={11} className="ngr-best-axis">100%</text>
        <polyline points={line("brake")} className="ngr-best-brake" />
        <polyline points={line("throttle")} className="ngr-best-throttle" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T - 4} y2={H - PAD_B} className="ngt-cursor" />}
      </svg>
      <div className="ngr-best-map">
        <LapMap trace={trace} trackId={trackId} variant="popup" range={[first, last]} hoverDistance={hover} width={300} height={170} />
      </div>
    </div>
  );
}
