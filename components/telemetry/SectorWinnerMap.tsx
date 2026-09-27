"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";
import { useMapZoomPan } from "@/lib/useMapZoomPan";

/**
 * "Quem manda em cada pedaço da pista" (auditoria B11, 26/09/2026): o mapa da pista pintado com a cor
 * do carro mais rápido em cada pedaço fixo de 5% da volta, entre TODOS os carros comparados.
 * Restaurado de 94c4d8d:components/CarComparison.tsx (`SectorMap`); os pedaços, o vencedor de cada um
 * e o contorno vêm prontos de /api/telemetry/car-comparison (`mapSegments`, `trackOutline`), sem cálculo
 * novo. Desenho Night Grid: contorno real (OSM) por baixo, sem esticar X/Y, zoom na roda e pan.
 */
export type OutlinePoint = { distance: number; lat: number; lon: number };
export type MapSegment = { startPct: number; endPct: number; winnerCarId: number | null };

const W = 380, H = 250;

export default function SectorWinnerMap({ outline, segments, colorByCar, trackId }: {
  outline: OutlinePoint[];
  segments: MapSegment[];
  colorByCar: Map<number, string>;
  trackId: number | null;
}) {
  const [boundary, setBoundary] = useState<TrackBoundary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    getTrackBoundary(trackId).then((result) => { if (!cancelled) setBoundary(result); });
    return () => { cancelled = true; };
  }, [trackId]);

  const boundaryPoints = boundary ? boundary.segments.flatMap((segment) => segment.pts.map(([lat, lon]) => ({ lat, lon }))) : [];
  // Enquadra pela pista inteira (contorno real, ou o traço completo), nunca só pelos pedaços pintados.
  const bounds = boundaryPoints.length ? boundaryPoints : outline;
  const projector = createTrackProjector(bounds.map((point) => ({ lat: point.lat, lon: point.lon })), W, H, 14, false);
  const { svgRef, camera, isDragging, onMouseDown, onTouchStart, transform } = useMapZoomPan(W, H, true, trackId, 1);

  if (outline.length < 20) return <div className="ngt-map-empty">Sem traçado GPS suficiente para pintar a pista.</div>;

  const fallbackWidth = Math.max(6, Math.min(30, projector.metersToPixels(12)));
  const pieces = segments.map((segment, index) => {
    const color = segment.winnerCarId !== null ? colorByCar.get(segment.winnerCarId) : undefined;
    // um ponto a mais de cada lado para os pedaços se encostarem sem buraco
    const points = outline.filter((point) => point.distance >= segment.startPct - 0.6 && point.distance <= segment.endPct + 0.6);
    return color && points.length > 1 ? { key: index, color, d: points.map((point) => projector(point)).join(" ") } : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <svg ref={svgRef} className="ngt-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Mapa da pista pintado com a cor do carro mais rápido em cada pedaço"
      style={{ cursor: isDragging ? "grabbing" : camera.scale > 1 ? "grab" : "default", touchAction: "none" }}
      onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
      <g style={{ transform }}>
        {boundary
          ? boundary.segments.map((segment, index) => (
            <polyline key={index} points={segment.pts.map(([lat, lon]) => projector({ lat, lon })).join(" ")} className="ngt-map-base" style={{ strokeWidth: Math.max(2, projector.metersToPixels(segment.width)) }} />
          ))
          : <polyline points={outline.map((point) => projector(point)).join(" ")} className="ngt-map-base" style={{ strokeWidth: fallbackWidth }} />}
        {pieces.map((piece) => (
          <polyline key={piece.key} points={piece.d} fill="none" stroke={piece.color} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
