"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";
import { useMapZoomPan } from "@/lib/useMapZoomPan";

/** Shared real-track-map component (29/08/2026: "esses mapas mencionados são o padrão para o
 * aplicativo inteiro. Onde não estiver utilizando, corrija com a utilização a partir de agora") --
 * draws the real OSM track-edge geometry (lib/track-boundaries.ts) when available for this track,
 * exactly like the own/reference map in "Melhor volta vs referência" (components/ActiveWeekTelemetry.tsx),
 * with one or more named/colored GPS lines drawn over it.
 *
 * Pan+zoom (01/09/2026: "eu quero usar o mouse para navegar... clico e movo o mouse para baixo eu vou
 * vendo a parte de cima do mapa... é uma funcionalidade bem conhecida") comes from the shared
 * lib/useMapZoomPan.ts hook -- scroll to zoom anchored at the cursor, click-and-drag to pan -- used by
 * every real-track map in the app so they all behave identically. */
export type TrackMapPoint = { distance: number; lat: number | null; lon: number | null };
export type TrackMapLine = { points: TrackMapPoint[]; color: string; dashed?: boolean };
export type TrackMapMarker = { lat: number; lon: number; color: string };

function metersBetween(a: TrackMapPoint, b: TrackMapPoint) {
  const latitude = ((Number(a.lat) + Number(b.lat)) / 2) * Math.PI / 180;
  const northSouth = (Number(b.lat) - Number(a.lat)) * 110_540;
  const eastWest = (Number(b.lon) - Number(a.lon)) * 111_320 * Math.cos(latitude);
  return Math.hypot(northSouth, eastWest);
}

// GPS exports occasionally contain a discontinuity (for example when the recorder reacquires a
// signal). Connecting both valid sides with one SVG polyline fabricates a diagonal across the map.
// Keep each continuous part visible, but never draw a route that was not driven.
function splitGpsSegments(points: TrackMapPoint[]) {
  return points.reduce<TrackMapPoint[][]>((segments, point) => {
    const current = segments[segments.length - 1];
    if (!current || metersBetween(current[current.length - 1], point) > 350) segments.push([point]);
    else current.push(point);
    return segments;
  }, []).filter((segment) => segment.length >= 2);
}

export default function TrackMap({ trackId, lines, width = 300, height = 200, className = "track-map", markers = [], boundsHint }: { trackId: number | null; lines: TrackMapLine[]; width?: number; height?: number; className?: string; markers?: TrackMapMarker[]; boundsHint?: { lat: number | null; lon: number | null }[] }) {
  const [boundary, setBoundary] = useState<TrackBoundary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    getTrackBoundary(trackId).then((result) => { if (!cancelled) setBoundary(result); });
    return () => { cancelled = true; };
  }, [trackId]);

  const gpsLines = lines.map((line) => {
    const gps = line.points.filter((point) => point.lat !== null && point.lon !== null);
    return { ...line, gps, segments: splitGpsSegments(gps) };
  });

  const boundaryPoints = boundary ? boundary.segments.flatMap((segment) => segment.pts.map(([lat, lon]) => ({ lat, lon }))) : [];
  // 12/09/2026: "aumenta a box do mapa para aparecer tudo" -- boundsHint lets a caller whose `lines`
  // don't span the whole track by themselves (CarComparison's SectorMap: a segment with no
  // determined winner is simply never added to `lines`, so the drawn lines' own extent could be a
  // handful of disconnected fragments instead of the full lap) say explicitly "fit to THIS instead"
  // -- here, the full lap outline. Without it, a `lines`-only fit plus the new fillScale zoom
  // (lib/track-map.ts) compounded into cropping most of the track away, which is what actually
  // shipped: fitting tight to two colored fragments, then zooming in further on that tiny bounds.
  const boundsGps = boundsHint?.length
    ? boundsHint.filter((point) => point.lat !== null && point.lon !== null)
    : null;
  // Fits to the lines' own GPS extent, not the whole track boundary -- these lines are usually
  // already a narrow window (one corner), so fitting to the real boundary instead would zoom out to
  // the whole circuit and shrink the actual comparison to a speck. (Callers that DO span the whole
  // track pass boundsHint instead of relying on this fallback -- see above.)
  const boundsPoints = boundsGps?.length
    ? boundsGps.map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) }))
    : boundaryPoints.length && gpsLines.every((line) => line.gps.length < 2)
    ? boundaryPoints
    : gpsLines.flatMap((line) => line.gps).map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) }));
  const projectGps = createTrackProjector(boundsPoints, width, height, 14, false);
  const project = (point: { lat: number | null; lon: number | null }) => projectGps({ lat: Number(point.lat), lon: Number(point.lon) });
  const trackWidthPx = Math.max(6, Math.min(30, projectGps.metersToPixels(12)));
  // 13/09/2026 fix: "ainda está com o zoom padrão aplicado no mobile" -- confirmed live (Spa,
  // 300x220 box) that fillScale correctly computed 2.5x (its own cap), the intended fix -- but a
  // boundsHint caller is asking to fit the WHOLE track (CarComparison's SectorMap: "aparecer
  // tudo"), and cropping part of that same whole track by default defeats the entire point of the
  // feature it asked for. fillScale is only useful when the box legitimately has empty margin
  // around a narrower subject (a single corner's own GPS window) that the driver would want to
  // zoom into anyway -- not when the subject IS the whole circuit and there's nothing to zoom
  // "into", only content to crop out.
  const initialScale = boundsGps?.length ? 1 : projectGps.fillScale;

  // resetKey=trackId: a map instance that stays mounted across a track change (e.g. Meu Debrief's
  // per-corner maps when switching Formula/Sports tabs, which reuses the same corner-number React key
  // for a different track's data) would otherwise keep whatever camera the previous track's map was
  // left at, applied to a completely different coordinate space (02/09/2026, same bug confirmed live
  // on ActiveWeekTelemetry's own sticky map at Le Mans -- see that file's own useMapZoomPan call).
  // 12/09/2026: initialScale (computed above, before this hook call) starts a narrow-subject map
  // already zoomed to fill its real empty margin, instead of the driver scroll-zooming in every
  // time -- but stays 1 (fit the whole thing, no crop) for a boundsHint whole-track view, see that
  // computation's own comment. boundsPoints only changes when trackId/lines actually change here
  // (not on hover), so this never fights the driver's own manual pan/zoom mid-interaction.
  const { svgRef, camera, isDragging, onMouseDown, onTouchStart, transform } = useMapZoomPan(width, height, true, trackId, initialScale);

  if (!gpsLines.some((line) => line.gps.length >= 2)) return <div className="track-map-empty">Mapa GPS indisponível.</div>;

  // 03/09/2026: "em vários pontos da análise da volta em Le Mans, identifiquei isso -- os traçados
  // fora da linha de corrida" -- boundary.segments held the WHOLE circuit's OSM ways (13.6km at Le
  // Mans), but a per-corner map projects using bounds fit to just that corner's own narrow GPS
  // window (see boundsPoints above). Any segment from a completely different part of the track that
  // happens to share nearby lat/lon (a long circuit like Le Mans loops back close to itself in
  // several places -- the pit straight runs near the Porsche Curves connector, for one) still got
  // projected into that same tiny viewBox, landing as a stray line with no relation to the actual
  // corner shown. Filtering to only segments with at least one point inside the window's own bounds
  // (padded generously, since a segment can still be legitimately part of this corner while starting
  // just outside the raw GPS extent) drops those unrelated far-away segments; harmless for whole-lap
  // maps (Melhor volta vs. referência, Comparar carros) since their own bounds already span the
  // whole track, so nothing real gets filtered out there.
  const BOUNDARY_PAD_METERS = 120;
  const boundsLats = boundsPoints.map((point) => point.lat);
  const boundsLons = boundsPoints.map((point) => point.lon);
  const boundsMinLat = Math.min(...boundsLats);
  const boundsMaxLat = Math.max(...boundsLats);
  const boundsMinLon = Math.min(...boundsLons);
  const boundsMaxLon = Math.max(...boundsLons);
  const boundsMeanLat = (boundsMinLat + boundsMaxLat) / 2;
  const padLat = BOUNDARY_PAD_METERS / 111_320;
  const padLon = BOUNDARY_PAD_METERS / (111_320 * Math.max(0.1, Math.cos((boundsMeanLat * Math.PI) / 180)));
  const paddedMinLat = boundsMinLat - padLat;
  const paddedMaxLat = boundsMaxLat + padLat;
  const paddedMinLon = boundsMinLon - padLon;
  const paddedMaxLon = boundsMaxLon + padLon;
  const visibleSegments = boundary
    ? boundary.segments.filter((segment) => segment.pts.some(([lat, lon]) => lat >= paddedMinLat && lat <= paddedMaxLat && lon >= paddedMinLon && lon <= paddedMaxLon))
    : [];

  return (
    <div className="track-map-zoom-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className={className} style={{ overflow: "hidden", cursor: isDragging ? "grabbing" : camera.scale > 1 ? "grab" : "default", touchAction: "none" }} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa real da pista com o traçado de cada carro"
        onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
        <g style={{ transform }}>
          {boundary
            ? visibleSegments.map((segment, index) => (
              <polyline key={index} points={segment.pts.map(([lat, lon]) => project({ lat, lon })).join(" ")} className="track-outline" style={{ strokeWidth: Math.max(2, projectGps.metersToPixels(segment.width)) }} />
            ))
            : gpsLines.flatMap((line, lineIndex) => line.segments.map((segment, segmentIndex) => <polyline key={`${lineIndex}-${segmentIndex}`} points={segment.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} />))}
          {gpsLines.flatMap((line, lineIndex) => line.segments.map((segment, segmentIndex) => (
            <polyline key={`${lineIndex}-${segmentIndex}`} points={segment.map(project).join(" ")} className="track-compare-line" style={{ stroke: line.color, strokeDasharray: line.dashed ? "6 5" : undefined }} />
          )))}
          {/* Hover markers (29/08/2026: "mexer em um [gráfico], faz a bolinha na pista se movimentar
           * para os dois carros") -- one dot per car, driven by whatever point the caller has already
           * interpolated for the current hover position; this component just draws them. Radius/stroke
           * divided by the camera scale so they keep a constant SCREEN size at any zoom. */}
          {markers.map((marker, index) => {
            const [x, y] = project({ lat: marker.lat, lon: marker.lon }).split(",");
            return <circle key={index} cx={x} cy={y} r={5 / camera.scale} style={{ fill: marker.color, stroke: "#08080a", strokeWidth: 1.5 / camera.scale }} />;
          })}
        </g>
      </svg>
    </div>
  );
}
