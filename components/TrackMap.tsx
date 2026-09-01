"use client";

import { useEffect, useRef, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";

/** Shared real-track-map component (29/08/2026: "esses mapas mencionados são o padrão para o
 * aplicativo inteiro. Onde não estiver utilizando, corrija com a utilização a partir de agora") --
 * draws the real OSM track-edge geometry (lib/track-boundaries.ts) when available for this track,
 * exactly like the own/reference map in "Melhor volta vs referência" (components/ActiveWeekTelemetry.tsx),
 * with one or more named/colored GPS lines drawn over it.
 *
 * Scroll-to-zoom-at-cursor (01/09/2026: "Em todos os minimapas, em todas as sub-abas de Analysis,
 * permita que eu possa aplicar zoom igual eu faço na sub-aba 'Melhor volta vs Referencia' usando o
 * scroll do mouse") -- mirrors that page's own TrackMap zoom implementation (wheel-to-zoom anchored
 * at the cursor, click-to-recenter, a non-passive native listener since React's onWheel can't
 * preventDefault the page scroll). That page's map keeps its own richer, workflow-specific
 * implementation (lineDistance-based reference-line reconstruction, hover markers driven by a
 * separate hover-distance prop) rather than being migrated onto this one; this shared component
 * only borrows the zoom/pan mechanics themselves. */
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

  const defaultCenter = { x: width / 2, y: height / 2 };
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCenter, setZoomCenter] = useState(defaultCenter);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const ctm = svg!.getScreenCTM();
      if (!ctm) return;
      const point = svg!.createSVGPoint();
      point.x = event.clientX; point.y = event.clientY;
      const local = point.matrixTransform(ctm.inverse());
      setZoomCenter({ x: local.x, y: local.y });
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25;
      setZoomLevel((level) => {
        const next = Math.max(1, Math.min(6, level * factor));
        if (next === 1) setZoomCenter(defaultCenter);
        return next;
      });
    }
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

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
    <div className="track-map-zoom-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className={className} style={{ overflow: "hidden" }} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa real da pista com o traçado de cada carro"
        onClick={(event) => {
          // Click-to-recenter, same as the full-track map: zoom anchors wherever you click, not just
          // the fixed center.
          const svg = event.currentTarget;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const point = svg.createSVGPoint();
          point.x = event.clientX; point.y = event.clientY;
          const local = point.matrixTransform(ctm.inverse());
          setZoomCenter({ x: local.x, y: local.y });
          setZoomLevel((level) => (level === 1 ? 2 : level));
        }}>
        <g style={{ transform: `translate(${zoomCenter.x}px,${zoomCenter.y}px) scale(${zoomLevel}) translate(${-zoomCenter.x}px,${-zoomCenter.y}px)` }}>
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
           * interpolated for the current hover position; this component just draws them. Radius/stroke
           * divided by zoomLevel so they keep a constant SCREEN size at any zoom, same as the full-track
           * map's own markers. */}
          {markers.map((marker, index) => {
            const [x, y] = project({ lat: marker.lat, lon: marker.lon }).split(",");
            return <circle key={index} cx={x} cy={y} r={5 / zoomLevel} style={{ fill: marker.color, stroke: "#08080a", strokeWidth: 1.5 / zoomLevel }} />;
          })}
        </g>
      </svg>
    </div>
  );
}
