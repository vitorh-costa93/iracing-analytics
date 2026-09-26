"use client";

import { useEffect, useRef, useState } from "react";
import { FocusedGaugePanel, type FocusedSide } from "@/components/FocusedGaugeChart";
import LapMap from "@/components/telemetry/LapMap";
import { lostInSectionAt, pointsInWindow, type SectionResult } from "@/lib/lap-analysis";
import { describeSection, formatSignedSeconds } from "@/lib/engineer-talk";
import { wrapDistance } from "@/lib/corner-sequences";
import { interpolate, type Trace } from "@/lib/telemetry-trace";

/**
 * Popup de um trecho (TelemetryPopup.dc.html): texto do engenheiro, quem paga e quem ganha dentro da
 * sequência, inputs você x referência com mostradores sincronizados, barra mais lento/mais rápido
 * que acompanha o hover e o mapa "Traçado" local com zoom/pan. Anterior/próxima (e setas), Esc fecha.
 */
export default function SectionPopup({ section, index, total, trace, referenceTrace, trackId, trackLengthMeters, category, isBiggestLoss, onPrev, onNext, onClose }: {
  section: SectionResult;
  index: number;
  total: number;
  trace: Trace;
  referenceTrace: Trace;
  trackId: number | null;
  trackLengthMeters: number | null;
  category: "sports" | "formula" | null;
  isBiggestLoss: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { setHover(null); }, [section.id]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); onNext(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); onPrev(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev]);

  const talk = describeSection(section, { isBiggestLoss });
  const gain = -section.lostSeconds;
  const loss = talk.tag === "Onde perde";
  const from = section.windowStart, to = section.windowEnd;
  const meters = (d: number) => (trackLengthMeters ? `${Math.round((wrapDistance(d) / 100) * trackLengthMeters).toLocaleString("pt-BR")} m` : `${wrapDistance(d).toFixed(1).replace(".", ",")}%`);
  const pctText = (d: number) => `${Math.round(wrapDistance(d))}%`;
  const plainMeters = (d: number) => Math.round((wrapDistance(d) / 100) * (trackLengthMeters ?? 0)).toLocaleString("pt-BR");
  const range = `${trackLengthMeters ? `${plainMeters(from)}–${plainMeters(to)} m · ` : ""}${pctText(from)}–${pctText(to)} da volta`;

  const ownPts = pointsInWindow(trace.points, from, to);
  const refPts = pointsInWindow(referenceTrace.points, from, to);
  const series = (items: typeof ownPts, field: "throttle" | "brake") => items
    .filter(({ point }) => point[field] !== null && Number.isFinite(point[field]))
    .map(({ point, d }) => ({ x: d, value: Number(point[field]) }));
  const at = hover ?? (section.start + section.end) / 2;
  const value = (source: Trace, field: "steering" | "gear" | "speed" | "throttle" | "brake") => interpolate(source.points, wrapDistance(at), field);
  const side = (key: string, label: string, color: string, dashed: boolean, source: Trace, items: typeof ownPts): FocusedSide => ({
    key, label, color, dashed,
    throttle: series(items, "throttle"), brake: series(items, "brake"),
    angleRad: value(source, "steering"), gear: value(source, "gear"), speedMs: value(source, "speed"),
    throttleNow: value(source, "throttle"), brakeNow: value(source, "brake"),
  });
  const sides = [side("own", "VOCÊ", "var(--ng-text)", false, trace, ownPts), side("reference", "REFERÊNCIA", "var(--ng-reference-popup)", true, referenceTrace, refPts)];

  const running = hover !== null ? lostInSectionAt(section.lostSeries, hover) : section.lostSeconds;
  const scale = Math.max(0.15, Math.abs(section.lostSeconds) * 1.15, Math.abs(running));
  const width = Math.min(48, (Math.abs(running) / scale) * 48);
  const runningLoss = running > 0.0005;
  const whole = section.isSequence ? "na sequência toda" : "na curva toda";

  return (
    <div className="ngt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ngt-popup" role="dialog" aria-modal="true" aria-labelledby="ngt-popup-title" data-category={category ?? undefined}>
        <div className="ngt-popup-head">
          <div>
            <div className="ngt-popup-kicker">{section.isSequence ? "Sequência de curvas" : section.label}</div>
            <h3 className="ngt-popup-title" id="ngt-popup-title">{section.label}{section.isSequence ? " · analisadas juntas" : ""}</h3>
            <div className="ngt-popup-range">{range}</div>
          </div>
          <div className="ngt-popup-nav">
            <button type="button" onClick={onPrev} disabled={index <= 0} aria-label="Trecho anterior">← Anterior</button>
            <button type="button" onClick={onNext} disabled={index >= total - 1} aria-label="Próximo trecho">Próxima →</button>
            <button type="button" className="ngt-close" onClick={onClose} ref={closeRef}>Fechar ✕</button>
          </div>
        </div>
        <p className="ngt-popup-detail">{talk.detail}</p>
        {section.isSequence && (
          <div className="ngt-seq">
            <div className="ngt-seq-title">SEQUÊNCIA: NÃO SE ANALISA CURVA A CURVA. QUEM PAGA E QUEM GANHA:</div>
            <div className="ngt-seq-parts">
              {section.parts.map((part) => (
                <div key={part.corner.number} className="ngt-seq-part">
                  <span>{part.label}</span>
                  <strong data-tone={part.lostSeconds > 0.005 ? "loss" : "gain"}>{formatSignedSeconds(-part.lostSeconds)}</strong>
                </div>
              ))}
              <div className="ngt-seq-part" data-total="">
                <span>Sequência inteira</span>
                <strong data-tone={loss ? "loss" : "gain"}>{formatSignedSeconds(gain)}</strong>
              </div>
            </div>
          </div>
        )}
        <FocusedGaugePanel sides={sides} xDomain={[from, to]} hoverX={hover} onHoverX={setHover} startLabel={meters(from)} endLabel={meters(to)}
          ariaLabel="Acelerador e freio da sua volta e da referência neste trecho; passe o mouse para ver os mostradores e a posição no mapa" />
        <div className="ngt-deltabar" aria-hidden>
          <span>MAIS LENTO</span>
          <div className="ngt-deltabar-track">
            <div className="ngt-bar-axis" />
            <div className="ngt-deltabar-fill" data-tone={runningLoss ? "loss" : "gain"} style={runningLoss ? { left: `${50 - width}%`, width: `${width}%` } : { left: "50%", width: `${width}%` }} />
          </div>
          <span>MAIS RÁPIDO</span>
        </div>
        <div className="ngt-deltabar-text" aria-live="polite">{hover === null ? `${formatSignedSeconds(gain)} ${whole}` : `${formatSignedSeconds(-running)} até aqui`}</div>
        <div className="ngt-trace">
          <div>
            <span className="ngt-trace-label">TRAÇADO</span>
            <div className="ngt-trace-map">
              <LapMap trace={trace} referenceTrace={referenceTrace} trackId={trackId} variant="popup" range={[from, to]} hoverDistance={at} width={380} height={230} />
            </div>
          </div>
          <div className="ngt-trace-side">
            <div className="ngt-legend"><span><i />Sua volta</span><span><i data-line="ref-popup" />Referência</span></div>
            <div className="ngt-trace-hint">{`${wrapDistance(at).toFixed(1).replace(".", ",")}% da volta · passe o mouse no gráfico para localizar o ponto no mapa`}</div>
            {talk.chips.map((chip) => (
              <div key={chip.k} className="ngt-chip-box" data-tone={chip.tone}><div>{chip.k}</div><div>{chip.v}</div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
