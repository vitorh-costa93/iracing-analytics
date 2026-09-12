"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";

/** Google-Maps-style pan+zoom for a viewBox-based SVG map, shared by every real-track map in the app
 * (01/09/2026: "eu quero usar o mouse para navegar... clico e movo o mouse para baixo eu vou vendo a
 * parte de cima do mapa, é como se eu clicasse e puxasse para fora da minha visão... é uma
 * funcionalidade bem conhecida"). Scroll wheel zooms anchored at the cursor; click-and-drag pans by
 * making the content follow the cursor 1:1, like grabbing the map itself -- replaces the old
 * click-to-recenter-then-step-zoom behavior, which the driver found unintuitive.
 *
 * Camera model: `scale` plus the CONTENT point (`centerX`,`centerY`, in the svg's own viewBox units)
 * that currently renders at the exact center of the `width`x`height` viewBox. A point Q renders at
 * screen position (w/2, h/2) + scale*(Q - center) -- see the wheel/drag handlers below for the algebra
 * that keeps the right point fixed under the cursor during each gesture. */
export type MapCamera = { scale: number; centerX: number; centerY: number };

const MIN_SCALE = 1;
// 02/09/2026: "é o máximo de zoom que eu consigo dar, quero muito mais... quero ver o detalhe dos
// traçados" -- 6x wasn't nearly enough to see own-vs-reference divergence at the sub-meter level a
// single corner needs. Bumped to 40x (matches the fine-grained zoom real timing tools allow).
const MAX_SCALE = 40;

function defaultCamera(width: number, height: number, initialScale = 1): MapCamera {
  return { scale: initialScale, centerX: width / 2, centerY: height / 2 };
}

// 11/09/2026: "dava para aplicar um zoom padrão no mapa, veja como tem espaço disponível" -- a track
// shape much narrower than its box (e.g. a tall/narrow track in a very tall mobile viewport) otherwise
// always starts at scale=1, centered with real empty margin on whichever axis wasn't the constraint.
// initialScale (createTrackProjector's own fillScale) sets a sensible starting zoom instead, without
// changing anything about how scroll-zoom/drag-pan work from there. Scroll-to-zero-out still resets to
// THIS default, not scale=1 -- "zoomed all the way out" should mean "as filled-in as it starts", not a
// smaller, more-empty view the driver would immediately have to zoom back in from.
export function useMapZoomPan(width: number, height: number, enabled = true, resetKey?: string | number | null, initialScale = 1) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [camera, setCamera] = useState<MapCamera>(() => defaultCamera(width, height, initialScale));
  const dragState = useRef<{ startLocal: { x: number; y: number }; startCenter: { x: number; y: number } } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // A different map instance (new popup, different corner) gets a fresh camera, not whatever the
  // previous instance's user left behind. width/height alone isn't enough for a map instance that
  // stays mounted across different underlying data (02/09/2026: "o Circuito de Le Mans está com
  // problema, zoom aplicado em uma região só" -- switching tracks in ActiveWeekTelemetry's own
  // sticky map reused the SAME component instance, so a camera zoomed/panned into one track's own
  // coordinate space carried over unchanged onto the next track's completely different one). Callers
  // whose map can swap content without remounting pass a resetKey (e.g. the track id) that changes
  // when that happens, forcing this same reset the width/height case already got.
  useEffect(() => { setCamera(defaultCamera(width, height, initialScale)); }, [width, height, resetKey, initialScale]);

  function localPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    return point.matrixTransform(ctm.inverse());
  }

  useEffect(() => {
    if (!enabled) return;
    const svg = svgRef.current;
    if (!svg) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const local = localPoint(event.clientX, event.clientY);
      if (!local) return;
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25;
      setCamera((prev) => {
        const nextScale = Math.max(initialScale, Math.min(MAX_SCALE, prev.scale * factor));
        if (nextScale === initialScale) return defaultCamera(width, height, initialScale);
        // Keep the content point currently under the cursor fixed on screen while scale changes.
        const contentX = prev.centerX + (local.x - width / 2) / prev.scale;
        const contentY = prev.centerY + (local.y - height / 2) / prev.scale;
        return { scale: nextScale, centerX: contentX - (local.x - width / 2) / nextScale, centerY: contentY - (local.y - height / 2) / nextScale };
      });
    }
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, width, height, initialScale]);

  function panTo(clientX: number, clientY: number) {
    const local = localPoint(clientX, clientY);
    const drag = dragState.current;
    if (!local || !drag) return;
    setCamera((prev) => ({
      ...prev,
      centerX: drag.startCenter.x - (local.x - drag.startLocal.x) / prev.scale,
      centerY: drag.startCenter.y - (local.y - drag.startLocal.y) / prev.scale,
    }));
  }

  useEffect(() => {
    if (!enabled) return;
    function handleMouseMove(event: MouseEvent) { panTo(event.clientX, event.clientY); }
    function handleMouseUp() { dragState.current = null; setIsDragging(false); }
    function handleTouchMove(event: TouchEvent) {
      if (!dragState.current || !event.touches[0]) return;
      event.preventDefault();
      panTo(event.touches[0].clientX, event.touches[0].clientY);
    }
    function handleTouchEnd() { dragState.current = null; setIsDragging(false); }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  function beginDrag(clientX: number, clientY: number) {
    // 1 (not initialScale) on purpose: a track drawn narrower than its box (initialScale > 1) already
    // has real off-screen content on the originally-unconstrained axis even at the default zoom, so
    // panning stays meaningful there -- only true scale=1 is guaranteed to have nothing to reveal.
    if (!enabled || camera.scale <= 1) return; // nothing to pan when fully zoomed out
    const local = localPoint(clientX, clientY);
    if (!local) return;
    dragState.current = { startLocal: local, startCenter: { x: camera.centerX, y: camera.centerY } };
    setIsDragging(true);
  }

  const onMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => { event.preventDefault(); beginDrag(event.clientX, event.clientY); };
  const onTouchStart = (event: ReactTouchEvent<SVGSVGElement>) => { if (event.touches[0]) beginDrag(event.touches[0].clientX, event.touches[0].clientY); };

  const transform = `translate(${width / 2}px, ${height / 2}px) scale(${camera.scale}) translate(${-camera.centerX}px, ${-camera.centerY}px)`;
  const zoomBy = (factor: number) => setCamera((prev) => {
    const nextScale = Math.max(initialScale, Math.min(MAX_SCALE, prev.scale * factor));
    return nextScale === initialScale ? defaultCamera(width, height, initialScale) : { ...prev, scale: nextScale };
  });
  const focusOn = (contentX: number, contentY: number, scale = 3) => setCamera({ scale, centerX: contentX, centerY: contentY });

  return { svgRef, camera, isDragging, isZoomed: camera.scale > initialScale, onMouseDown, onTouchStart, transform, zoomBy, focusOn };
}
