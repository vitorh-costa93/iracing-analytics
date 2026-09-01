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
const MAX_SCALE = 6;

function defaultCamera(width: number, height: number): MapCamera {
  return { scale: 1, centerX: width / 2, centerY: height / 2 };
}

export function useMapZoomPan(width: number, height: number, enabled = true) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [camera, setCamera] = useState<MapCamera>(() => defaultCamera(width, height));
  const dragState = useRef<{ startLocal: { x: number; y: number }; startCenter: { x: number; y: number } } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // A different map instance (new popup, different corner) gets a fresh camera, not whatever the
  // previous instance's user left behind.
  useEffect(() => { setCamera(defaultCamera(width, height)); }, [width, height]);

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
        const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
        if (nextScale === MIN_SCALE) return defaultCamera(width, height);
        // Keep the content point currently under the cursor fixed on screen while scale changes.
        const contentX = prev.centerX + (local.x - width / 2) / prev.scale;
        const contentY = prev.centerY + (local.y - height / 2) / prev.scale;
        return { scale: nextScale, centerX: contentX - (local.x - width / 2) / nextScale, centerY: contentY - (local.y - height / 2) / nextScale };
      });
    }
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, width, height]);

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
    if (!enabled || camera.scale <= MIN_SCALE) return; // nothing to pan when fully zoomed out
    const local = localPoint(clientX, clientY);
    if (!local) return;
    dragState.current = { startLocal: local, startCenter: { x: camera.centerX, y: camera.centerY } };
    setIsDragging(true);
  }

  const onMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => { event.preventDefault(); beginDrag(event.clientX, event.clientY); };
  const onTouchStart = (event: ReactTouchEvent<SVGSVGElement>) => { if (event.touches[0]) beginDrag(event.touches[0].clientX, event.touches[0].clientY); };

  const transform = `translate(${width / 2}px, ${height / 2}px) scale(${camera.scale}) translate(${-camera.centerX}px, ${-camera.centerY}px)`;
  const zoomBy = (factor: number) => setCamera((prev) => {
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
    return nextScale === MIN_SCALE ? defaultCamera(width, height) : { ...prev, scale: nextScale };
  });
  const focusOn = (contentX: number, contentY: number, scale = 3) => setCamera({ scale, centerX: contentX, centerY: contentY });

  return { svgRef, camera, isDragging, isZoomed: camera.scale > MIN_SCALE, onMouseDown, onTouchStart, transform, zoomBy, focusOn };
}
