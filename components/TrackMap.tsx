"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";

/** Shared real-track-map component (29/08/2026: "esses mapas mencionados são o padrão para o
 * aplicativo inteiro. Onde não estiver utilizando, corrija com a utilização a partir de agora") --
 * draws the real OSM track-edge geometry (lib/track-boundaries.ts) when available for this track,
 * exactly like the own/reference map in "Melhor volta vs referência" (components/ActiveWeekTelemetry.tsx),
 * with one or more named/colored GPS lines drawn over it. That page's own TrackMap keeps its own
 * richer implementation (manual zoom/pan, hover markers, a lineDistance-based reference-line
 * reconstruction specific to its own/reference workflow) rather than being migrated onto this one --
 * no behavior change there, same real-boundary result it already had. This shared component is for
 * new N-line comparisons (car-comparison's per-corner deep-dive) that don't need that machinery. */
export type TrackMapPoint = { distance: number; lat: number | null; lon: number | null };
export type TrackMapLine = { points: TrackMapPoint[]; color: string; dashed?: boolean };
export type TrackMapMarker = { lat: number; lon: number; color: string };

export default function TrackMap({ trackId, lines, width = 300, height = 200, className = "track-map", markers = [] }: { trackId: number | null; lines: TrackMapLine[]; width?: number; height?: number; className?: string; markers?: TrackMapMarker[] }) {
  const [boundary, setBoundary] = useState<TrackBoundary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    getTrackBoundary(trackId).then((result) => { if (!cancelled) setBoundary(result); });
    return () => { cancelled = true; };
  }, [trackId]);

  const gpsLines = lines.map((line) => ({ ...line, gps: line.points.filter((point) => point.lat !== null && point.lon !== null) }));
  if (!gpsLines.some((line) => line.gps.length >= 2)) return <div className="track-map-empty">Mapa GPS indisponível.</div>;

  const boundaryPoints = boundary ? boundary.segments.flatMap((segment) => segment.pts.map(([lat, lon]) => ({ lat, lon }))) : [];
  // Fits to the lines' own GPS extent, not the whole track boundary -- these lines are usually
  // already a narrow window (one corner), so fitting to the real boundary instead would zoom out to
  // the whole circuit and shrink the actual comparison to a speck.
  const boundsPoints = boundaryPoints.length && gpsLines.every((line) => line.gps.length < 2)
    ? boundaryPoints
    : gpsLines.flatMap((line) => line.gps).map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) }));
  const projectGps = createTrackProjector(boundsPoints, width, height, 14, false);
  const project = (point: { lat: number | null; lon: number | null }) => projectGps({ lat: Number(point.lat), lon: Number(point.lon) });
  const trackWidthPx = Math.max(6, Math.min(30, projectGps.metersToPixels(12)));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} style={{ overflow: "hidden" }} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa real da pista com o traçado de cada carro">
      {boundary
        ? boundary.segments.map((segment, index) => (
          <polyline key={index} points={segment.pts.map(([lat, lon]) => project({ lat, lon })).join(" ")} className="track-outline" style={{ strokeWidth: Math.max(2, projectGps.metersToPixels(segment.width)) }} />
        ))
        : gpsLines.map((line, index) => line.gps.length > 1 ? <polyline key={index} points={line.gps.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} /> : null)}
      {gpsLines.map((line, index) => line.gps.length > 1 ? (
        <polyline key={index} points={line.gps.map(project).join(" ")} className="track-compare-line" style={{ stroke: line.color, strokeDasharray: line.dashed ? "6 5" : undefined }} />
      ) : null)}
      {/* Hover markers (29/08/2026: "mexer em um [gráfico], faz a bolinha na pista se movimentar
       * para os dois carros") -- one dot per car, driven by whatever point the caller has already
       * interpolated for the current hover position; this component just draws them. */}
      {markers.map((marker, index) => {
        const [x, y] = project({ lat: marker.lat, lon: marker.lon }).split(",");
        return <circle key={index} cx={x} cy={y} r="5" style={{ fill: marker.color, stroke: "#08080a", strokeWidth: 1.5 }} />;
      })}
    </svg>
  );
}
