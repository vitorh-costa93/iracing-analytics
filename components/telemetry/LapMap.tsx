"use client";

import { useEffect, useState } from "react";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";
import { useMapZoomPan } from "@/lib/useMapZoomPan";
import { unwrapIntoWindow, wrapDistance } from "@/lib/corner-sequences";
import { nearestGpsPoint, type Trace, type TracePoint } from "@/lib/telemetry-trace";

/**
 * Mapa GPS da volta no estilo Night Grid (redesign etapa 3). Mesma lógica do mapa que vivia dentro
 * de components/ActiveWeekTelemetry.tsx: contorno real (OSM, lib/track-boundaries.ts) quando existe,
 * GPS real de cada volta (nunca reconstruído), projeção sem esticar X/Y, zoom na roda e pan por
 * arrasto (lib/useMapZoomPan.ts) com reset ao trocar de pista, e, no popup, só a região local do
 * trecho. Novidade: descontinuidades de GPS viram segmentos separados (sem diagonal falsa).
 *
 * `variant="position"`: pista inteira (Track Position), marcadores de trecho e bolinha vermelha.
 * `variant="popup"`: janela do trecho (Traçado), com a referência em roxo.
 */
export type LapMapMarker = { id: string; distance: number; label: string; tone: "loss" | "gain" };

type GpsLike = { lat: number | null; lon: number | null };

function metersBetween(a: GpsLike, b: GpsLike) {
  const latitude = ((Number(a.lat) + Number(b.lat)) / 2) * Math.PI / 180;
  return Math.hypot((Number(b.lat) - Number(a.lat)) * 110_540, (Number(b.lon) - Number(a.lon)) * 111_320 * Math.cos(latitude));
}

function splitGpsSegments<T extends GpsLike>(points: T[]) {
  return points.reduce<T[][]>((segments, point) => {
    const current = segments[segments.length - 1];
    if (!current || metersBetween(current[current.length - 1], point) > 350) segments.push([point]);
    else current.push(point);
    return segments;
  }, []).filter((segment) => segment.length >= 2);
}

const validGps = (point: TracePoint) => point.lat !== null && point.lon !== null && !(point.lat === 0 && point.lon === 0);

export default function LapMap({ trace, referenceTrace, trackId, variant, range = null, hoverDistance = null, markers = [], onMarkerClick, width = 380, height = 330 }: {
  trace: Trace;
  referenceTrace?: Trace | null;
  trackId: number | null;
  variant: "position" | "popup";
  /** janela do trecho (pode estar desenrolada, ex.: -3 a 4) */
  range?: [number, number] | null;
  hoverDistance?: number | null;
  markers?: LapMapMarker[];
  onMarkerClick?: (id: string) => void;
  width?: number;
  height?: number;
}) {
  const [boundary, setBoundary] = useState<TrackBoundary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    getTrackBoundary(trackId).then((result) => { if (!cancelled) setBoundary(result); });
    return () => { cancelled = true; };
  }, [trackId]);

  const gps = trace.points.filter(validGps);
  const refGps = referenceTrace ? referenceTrace.points.filter(validGps) : [];
  // +-1% de contexto em volta do trecho: aproximação e saída visíveis sem engolir as curvas vizinhas.
  const mapRange = range ? [range[0] - 1, range[1] + 1] as [number, number] : null;
  const inRange = (points: TracePoint[]) => mapRange
    ? points
      .map((point) => ({ point, d: unwrapIntoWindow(point.distance, mapRange[0], mapRange[1]) }))
      .filter((item): item is { point: TracePoint; d: number } => item.d !== null)
      .sort((a, b) => a.d - b.d)
      .map((item) => item.point)
    : [];
  const selected = inRange(gps);
  const refSelected = inRange(refGps);
  const boundaryPoints = boundary ? boundary.segments.flatMap((segment) => segment.pts.map(([lat, lon]) => ({ lat, lon }))) : [];

  const zoomed = variant === "popup";
  let boundsPoints: GpsLike[] = gps;
  if (zoomed && (selected.length >= 2 || refSelected.length >= 2)) boundsPoints = [...selected, ...refSelected];
  else if (!zoomed && boundaryPoints.length) boundsPoints = boundaryPoints;
  const projectGps = createTrackProjector(boundsPoints.map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) })), width, height, 18, false);
  const project = (point: GpsLike) => projectGps({ lat: Number(point.lat), lon: Number(point.lon) });
  const xy = (point: GpsLike) => project(point).split(",").map(Number) as [number, number];
  const isFullTrackView = !zoomed && boundaryPoints.length > 0;
  const initialScale = isFullTrackView ? 1 : projectGps.fillScale;
  // resetKey inclui o trecho no popup: anterior/próxima reenquadra, o hover nunca mexe na câmera.
  const resetKey = zoomed && range ? `${trackId}:${range[0].toFixed(2)}:${range[1].toFixed(2)}` : trackId;
  const { svgRef, camera, isDragging, onMouseDown, onTouchStart, transform } = useMapZoomPan(width, height, true, resetKey, initialScale);

  if (gps.length < 20) return <div className="ngt-map-empty">Mapa GPS indisponível nesta volta.</div>;

  const BOUNDARY_PAD_METERS = 120;
  const lats = boundsPoints.map((point) => Number(point.lat));
  const lons = boundsPoints.map((point) => Number(point.lon));
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const padLat = BOUNDARY_PAD_METERS / 111_320;
  const padLon = BOUNDARY_PAD_METERS / (111_320 * Math.max(0.1, Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)));
  const visibleSegments = boundary
    ? boundary.segments.filter((segment) => segment.pts.some(([lat, lon]) => lat >= minLat - padLat && lat <= maxLat + padLat && lon >= minLon - padLon && lon <= maxLon + padLon))
    : [];

  const ownLines = splitGpsSegments(zoomed && selected.length >= 2 ? selected : gps);
  const refLines = splitGpsSegments(zoomed && refSelected.length >= 2 ? refSelected : refGps);
  const fallbackWidth = Math.max(6, Math.min(40, projectGps.metersToPixels(12)));
  const hover = hoverDistance !== null ? wrapDistance(hoverDistance) : null;
  const hoverOwn = hover !== null ? nearestGpsPoint(gps, hover) : null;
  const hoverRef = hover !== null && refGps.length ? nearestGpsPoint(refGps, hover) : null;
  const k = 1 / camera.scale; // marcadores e bolinhas mantêm o tamanho na tela em qualquer zoom

  return (
    <svg ref={svgRef} className="ngt-map" data-variant={variant} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label={zoomed ? "Traçado da sua volta e da referência neste trecho" : "Mapa da pista com a sua volta, a referência e os trechos analisados"}
      style={{ cursor: isDragging ? "grabbing" : camera.scale > 1 ? "grab" : "default", touchAction: "none" }}
      onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
      <g style={{ transform }}>
        {boundary
          ? visibleSegments.map((segment, index) => (
            <polyline key={index} points={segment.pts.map(([lat, lon]) => project({ lat, lon })).join(" ")} className="ngt-map-base" style={{ strokeWidth: Math.max(2, projectGps.metersToPixels(segment.width)) }} />
          ))
          : splitGpsSegments(gps).map((segment, index) => <polyline key={index} points={segment.map(project).join(" ")} className="ngt-map-base" style={{ strokeWidth: fallbackWidth }} />)}
        {zoomed && selected.length >= 2 && splitGpsSegments(selected).map((segment, index) => (
          <polyline key={`seg-${index}`} points={segment.map(project).join(" ")} className="ngt-map-seg" style={{ strokeWidth: Math.max(8, projectGps.metersToPixels(16)), opacity: 0.55 }} />
        ))}
        {refLines.map((segment, index) => <polyline key={`ref-${index}`} points={segment.map(project).join(" ")} className="ngt-map-ref" />)}
        {ownLines.map((segment, index) => <polyline key={`own-${index}`} points={segment.map(project).join(" ")} className="ngt-map-own" />)}
        {!zoomed && markers.map((marker) => {
          const point = nearestGpsPoint(gps, wrapDistance(marker.distance));
          if (!point) return null;
          const [x, y] = xy(point);
          const r = (marker.label.length > 3 ? 13 : 10) * k;
          return (
            <g key={marker.id} className="ngt-map-marker" data-tone={marker.tone} role="button" tabIndex={-1}
              onMouseDown={(event) => event.stopPropagation()} onClick={() => onMarkerClick?.(marker.id)}>
              <title>{`Abrir ${marker.label}`}</title>
              <circle cx={x} cy={y} r={r} style={{ strokeWidth: k }} />
              <text x={x} y={y + 3.5 * k} textAnchor="middle" style={{ fontSize: `${(marker.label.length > 3 ? 8.5 : 10) * k}px` }}>{marker.label}</text>
            </g>
          );
        })}
        {hoverRef && (() => { const [x, y] = xy(hoverRef); return <circle cx={x} cy={y} r={3.2 * k} className="ngt-ball-ref" style={{ strokeWidth: 1.2 * k }} />; })()}
        {hoverOwn && (() => {
          const [x, y] = xy(hoverOwn);
          return zoomed
            ? <circle cx={x} cy={y} r={6 * k} className="ngt-ball" style={{ strokeWidth: 2.5 * k }} />
            : <g><circle cx={x} cy={y} r={9 * k} className="ngt-ball-halo" /><circle cx={x} cy={y} r={5 * k} className="ngt-ball" style={{ strokeWidth: 1.5 * k }} /></g>;
        })()}
      </g>
    </svg>
  );
}
