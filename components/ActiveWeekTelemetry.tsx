"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { detectLapCorners } from "@/lib/lap-corners";
import { trackUiEvent } from "@/lib/track-ui-event";
import { formatLapTime, hasCompleteGps, ibtToBestLapCsv, parseTelemetryCsv, traceUsesOvertake, type Trace, type TracePoint } from "@/lib/telemetry-trace";
import { compareLaps } from "@/lib/lap-analysis";
import { formatSignedSeconds } from "@/lib/engineer-talk";
import type { LapCorner } from "@/lib/corner-sequences";
import { Panel, SelectPill } from "@/components/ui";
import LapMap, { type LapMapMarker } from "@/components/telemetry/LapMap";
import RepresentativeLapChart, { sectionNameAt } from "@/components/telemetry/RepresentativeLapChart";
import CornerByCorner, { filterSections, isLossSection, type CornerFilter } from "@/components/telemetry/CornerByCorner";
import SectionPopup from "@/components/telemetry/SectionPopup";

/**
 * Telemetry Lab · semana ativa no Night Grid (redesign etapa 3, 25/09/2026; mockups
 * docs/redesign-mockup/Telemetry.dc.html e TelemetryPopup.dc.html).
 *
 * Mesmos dados de antes, Supabase-first: /api/telemetry/active-week (contextos e volta
 * representativa), a telemetria dessa volta e a referência do carro/pista. Nenhuma chamada nova ao
 * Garage61 nem download extra: o gap dos cartões que não estão abertos vem só de um cache local
 * (localStorage) da última vez que aquele contexto foi analisado neste navegador.
 *
 * A análise (lib/lap-analysis.ts) cobre TODOS os trechos de curva, com curvas coladas agrupadas em
 * sequências (lib/corner-sequences.ts), e os textos saem de lib/engineer-talk.ts.
 */
type Combination = {
  key: string;
  label: string;
  car: { id: number; name: string; category?: "sports" | "formula" | null; carClass?: string | null };
  track: { id: number; name: string; variant: string | null };
  sessions: number;
  sessionTypes: number[];
  lapsFound: number;
  bestLap: null | { id: string; lapTime: number; startTime: string; sessionType: number | null; selectionReason: string; telemetryUrl: string };
};

type ActiveWeekData = {
  status: string;
  week: null | { seasonName: string; number: number; start: string; end: string };
  combinations: Combination[];
};

type Reference = { filename: string; uploadedAt: string; csv: string };

const GAP_CACHE_KEY = "ngt-context-gap:v1";
type GapCache = Record<string, { gap: number; reference: string }>;

function readGapCache(): GapCache {
  try { return JSON.parse(window.localStorage.getItem(GAP_CACHE_KEY) ?? "{}") as GapCache; } catch { return {}; }
}
function writeGapCache(cache: GapCache) {
  try { window.localStorage.setItem(GAP_CACHE_KEY, JSON.stringify(cache)); } catch { /* conveniência local apenas */ }
}

/** Detecção de curvas compartilhada com o Race Debrief e a Comparação de carros (lib/lap-corners.ts). */
function detectCorners(points: TracePoint[], trackName: string, trackVariant: string): LapCorner[] {
  return detectLapCorners(points, trackName, trackVariant);
}

/** Contextos com corrida primeiro, depois os com mais sessões e voltas. */
function rankContexts(items: Combination[]) {
  return [...items].sort((a, b) =>
    Number(!a.bestLap) - Number(!b.bestLap)
    || Number(!a.sessionTypes.includes(3)) - Number(!b.sessionTypes.includes(3))
    || b.sessions - a.sessions
    || b.lapsFound - a.lapsFound);
}

const isSf23 = (name: string) => /super formula sf23/i.test(name);

export default function ActiveWeekTelemetry() {
  const [data, setData] = useState<ActiveWeekData | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [traceLoading, setTraceLoading] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [referenceTrace, setReferenceTrace] = useState<Trace | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [referenceMessage, setReferenceMessage] = useState<string | null>(null);
  const [referenceMessageError, setReferenceMessageError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [filter, setFilter] = useState<CornerFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [gapCache, setGapCache] = useState<GapCache>({});
  const [retryCount, setRetryCount] = useState(0);
  const retry = () => setRetryCount((count) => count + 1);

  useEffect(() => { setGapCache(readGapCache()); }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/telemetry/active-week", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Erro ao carregar telemetria");
        if (!active) return;
        setData(result);
        setSelectedKey((current) => current || rankContexts(result.combinations ?? [])[0]?.key || "");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  const ranked = useMemo(() => rankContexts(data?.combinations ?? []), [data]);
  const selected = useMemo(() => ranked.find((item) => item.key === selectedKey) ?? null, [ranked, selectedKey]);

  useEffect(() => {
    let active = true;
    setTrace(null);
    setError(null);
    setHover(null);
    setOpenId(null);
    if (!selected?.bestLap) return () => { active = false; };
    setTraceLoading(true);
    fetch(selected.bestLap.telemetryUrl, { cache: "no-store" })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) throw new Error("Não foi possível baixar a telemetria da volta representativa");
        if (active) setTrace(parseTelemetryCsv(text));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setTraceLoading(false));
    return () => { active = false; };
  }, [selected, retryCount]);

  useEffect(() => {
    let active = true;
    setReference(null);
    setReferenceTrace(null);
    setReferenceMessage(null);
    setReferenceMessageError(false);
    if (!selected) return () => { active = false; };
    setReferenceLoading(true);
    fetch(`/api/telemetry/reference?carId=${selected.car.id}&trackId=${selected.track.id}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Erro ao carregar referência");
        if (active && result.reference) {
          const parsed = parseTelemetryCsv(result.reference.csv);
          if (isSf23(selected.car.name) && traceUsesOvertake(parsed)) throw new Error("A referência ativa usa P2P/Overtake. Envie uma volta sem esse recurso.");
          setReference(result.reference);
          setReferenceTrace(parsed);
        }
      })
      .catch((reason) => { if (active) { setReferenceMessage(reason instanceof Error ? reason.message : String(reason)); setReferenceMessageError(true); } })
      .finally(() => active && setReferenceLoading(false));
    return () => { active = false; };
  }, [selected]);

  const corners = useMemo(() => (trace && selected ? detectCorners(trace.points, selected.track.name, selected.track.variant ?? "") : []), [trace, selected]);
  const comparison = useMemo(() => {
    if (!trace || !referenceTrace || !selected?.bestLap) return null;
    return compareLaps(trace, referenceTrace, selected.bestLap.lapTime, corners);
  }, [trace, referenceTrace, selected, corners]);
  const gpsOk = useMemo(() => (trace ? hasCompleteGps(trace) : false), [trace]);

  // Guarda só o número (gap) por volta representativa + referência, para os outros cartões.
  useEffect(() => {
    if (!comparison || !selected?.bestLap || !reference) return;
    const entry = { gap: comparison.estimatedGap, reference: `${reference.filename}|${reference.uploadedAt}` };
    setGapCache((previous) => {
      const next = { ...previous, [selected.bestLap!.id]: entry };
      writeGapCache(next);
      return next;
    });
  }, [comparison, selected, reference]);

  const visibleSections = useMemo(() => (comparison ? filterSections(comparison.sections, filter) : []), [comparison, filter]);
  const openIndex = visibleSections.findIndex((section) => section.id === openId);
  const openSection = openIndex >= 0 ? visibleSections[openIndex] : null;
  const biggestLossId = useMemo(() => {
    const losses = comparison?.sections.filter(isLossSection) ?? [];
    return losses.length ? losses.reduce((a, b) => (a.lostSeconds > b.lostSeconds ? a : b)).id : null;
  }, [comparison]);

  const openSectionById = useCallback((id: string) => {
    setOpenId(id);
    const section = comparison?.sections.find((item) => item.id === id);
    if (selected && section) trackUiEvent("telemetry_opportunity_opened", { carId: selected.car.id, trackId: selected.track.id, category: section.isSequence ? "sequence" : "corner" });
  }, [comparison, selected]);
  const closePopup = useCallback(() => setOpenId(null), []);
  const prev = useCallback(() => { if (openIndex > 0) setOpenId(visibleSections[openIndex - 1].id); }, [openIndex, visibleSections]);
  const next = useCallback(() => { if (openIndex >= 0 && openIndex < visibleSections.length - 1) setOpenId(visibleSections[openIndex + 1].id); }, [openIndex, visibleSections]);

  function selectContext(item: Combination) {
    if (item.key === selectedKey) return;
    setSelectedKey(item.key);
    trackUiEvent("telemetry_context_selected", { carId: item.car.id, trackId: item.track.id, selectionReason: item.bestLap?.selectionReason ?? "unavailable" });
  }

  async function uploadReference(file: File) {
    if (!selected) return;
    setUploading(true);
    setReferenceMessage("Validando e armazenando a referência…");
    setReferenceMessageError(false);
    try {
      let uploadFile = file;
      if (file.name.toLowerCase().endsWith(".ibt")) {
        setReferenceMessage("Lendo o IBT aqui no navegador e procurando a volta completa mais rápida…");
        const converted = ibtToBestLapCsv(await file.arrayBuffer());
        uploadFile = new File([converted.csv], `${file.name.replace(/\.ibt$/i, "")}-best-lap.csv`, { type: "text/csv" });
        setReferenceMessage(`Volta de ${formatLapTime(converted.duration)} extraída. Enviando a referência…`);
      }
      const parsedUpload = parseTelemetryCsv(await uploadFile.text());
      if (isSf23(selected.car.name) && traceUsesOvertake(parsedUpload)) throw new Error("A referência usa P2P/Overtake. Escolha uma volta sem esse recurso.");
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("carId", String(selected.car.id));
      form.set("trackId", String(selected.track.id));
      const response = await fetch("/api/telemetry/reference", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no envio da referência");
      const parsedReference = parseTelemetryCsv(result.reference.csv);
      if (isSf23(selected.car.name) && traceUsesOvertake(parsedReference)) throw new Error("A referência armazenada usa P2P/Overtake. Escolha uma volta sem esse recurso.");
      setReference(result.reference);
      setReferenceTrace(parsedReference);
      setReferenceMessage(null);
    } catch (reason) {
      setReferenceMessage(reason instanceof Error ? reason.message : String(reason));
      setReferenceMessageError(true);
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="ngt-state">Identificando carros e pistas da semana…</div>;
  if (!data && error) return <div className="ngt-state" data-tone="error">{error}<button type="button" className="ngt-link-button" onClick={retry}>Tentar novamente</button></div>;
  if (!ranked.length) return <div className="ngt-state">Nenhuma atividade encontrada na semana vigente.</div>;

  const top = ranked.slice(0, 3);
  const cards = selected && !top.some((item) => item.key === selected.key) ? [...top.slice(0, 2), selected] : top;
  const category = selected?.car.category ?? null;
  const trackLength = comparison?.trackLengthMeters ?? trace?.trackLengthMeters ?? null;

  const lapKind = selected?.bestLap?.selectionReason.startsWith("race") ? "de corrida" : selected?.bestLap?.selectionReason === "practice_best_lap" ? "de practice" : "limpa";
  const eligibility = selected?.bestLap
    ? `Volta ${lapKind} elegível${selected && isSf23(selected.car.name) ? ", sem P2P ativo" : ""}${trace ? (gpsOk ? " e com o traçado completo no GPS" : "; o GPS desta volta tem falhas, então o mapa pode ficar incompleto") : ""} · passe o mouse para comparar`
    : "Ainda não há uma volta limpa com telemetria para este contexto.";

  const uploadButton = (label: string) => (
    <label className="ngt-link-button" aria-disabled={uploading}>
      {uploading ? "Enviando…" : label}
      <input type="file" accept=".csv,.ibt,text/csv,application/octet-stream" disabled={uploading} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void uploadReference(file);
        event.target.value = "";
      }} />
    </label>
  );

  const markers: LapMapMarker[] = (comparison?.sections ?? []).map((section) => ({
    id: section.id,
    distance: (section.start + section.end) / 2,
    label: section.corners.length > 1 ? `${section.corners[0].number}–${section.corners[section.corners.length - 1].number}` : String(section.corners[0].number),
    tone: isLossSection(section) ? "loss" : "gain",
  }));

  return (
    <div className="ngt-screen">
      {ranked.length > 3 && (
        <div className="ngt-more-contexts">
          <span>{data?.week ? `${data.week.seasonName} · Week ${data.week.number} · ${ranked.length} contextos com atividade` : `${ranked.length} contextos com atividade`}</span>
          <SelectPill ariaLabel="Outros contextos da semana" value={selectedKey}
            options={ranked.map((item) => ({ value: item.key, label: `${item.track.name} · ${item.car.name}` }))}
            onChange={(key) => { const item = ranked.find((entry) => entry.key === key); if (item) selectContext(item); }} />
        </div>
      )}

      <div className="ngt-contexts" role="group" aria-label="Contextos da semana">
        {cards.map((item) => {
          const cached = item.bestLap ? gapCache[item.bestLap.id] : undefined;
          const live = item.key === selectedKey && comparison ? comparison.estimatedGap : null;
          const gap = live ?? cached?.gap ?? null;
          const noReference = item.key === selectedKey && !referenceLoading && !referenceTrace;
          return (
            <button key={item.key} type="button" className="ngt-context" aria-pressed={item.key === selectedKey} onClick={() => selectContext(item)}
              title={`${item.track.name}${item.track.variant ? ` (${item.track.variant})` : ""} · ${item.car.name}`}>
              <span className="ngt-context-bar" data-category={item.car.category ?? undefined} />
              <div className="ngt-context-main">
                <div className="ngt-context-track">{item.track.name}</div>
                <div className="ngt-context-car">{item.car.name}{item.car.carClass ? ` · ${item.car.carClass}` : ""} · {item.lapsFound} voltas</div>
              </div>
              <div className="ngt-context-side">
                <div className="ngt-context-best">{item.bestLap ? formatLapTime(item.bestLap.lapTime) : "—"}</div>
                <div className="ngt-context-gap" data-tone={gap === null ? undefined : gap > 0 ? "loss" : "gain"}>
                  {gap !== null ? `${formatSignedSeconds(gap)} vs. ref.` : noReference ? "sem referência" : "gap ao abrir"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="ngt-lap-grid">
          <Panel className="ngt-tall" kicker="Volta representativa" title="Tempo perdido e o que você fez nos pedais"
            subtitle={<>
              <div>{eligibility}</div>
              {referenceTrace && reference && (
                <div className="ngt-refline"><span>Referência: {reference.filename} · enviada em {new Date(reference.uploadedAt).toLocaleDateString("pt-BR")}</span>{uploadButton("Trocar referência")}</div>
              )}
              {referenceMessage && <div className="ngt-refline" data-tone={referenceMessageError ? "error" : undefined}><span>{referenceMessage}</span></div>}
            </>}
            actions={comparison ? <div className="ngt-legend"><span><i />Sua volta</span><span><i data-line="ref" />Referência</span></div> : undefined}>
            {traceLoading || (referenceLoading && trace) ? <div className="ngt-empty-chart">Carregando a telemetria da volta…</div>
              : error ? <div className="ngt-empty-chart" role="alert">{error}<button type="button" className="ngt-link-button" onClick={retry}>Tentar novamente</button></div>
              : !selected.bestLap ? <div className="ngt-empty-chart">Ainda não há uma volta limpa com telemetria para este carro e pista nesta semana.</div>
              : !referenceTrace ? <div className="ngt-empty-chart">Ainda não há volta de referência para este carro e pista. Envie um CSV ou IBT do iRacing (uma volta limpa, sem P2P) para ver onde você perde tempo.{uploadButton("Enviar referência")}</div>
              : trace && comparison ? <RepresentativeLapChart trace={trace} referenceTrace={referenceTrace} comparison={comparison} sectionName={(d) => sectionNameAt(comparison, d)} hover={hover} onHover={setHover} />
              : trace ? <div className="ngt-empty-chart">Não foi possível alinhar amostras suficientes entre a sua volta e a referência.</div>
              : null}
          </Panel>
          <Panel className="ngt-tall" kicker="Track Position" title={selected.track.name} subtitle="A bolinha segue o ponto do gráfico · gire para ampliar, arraste para mover">
            <div className="ngt-map-wrap">
              {trace ? <LapMap trace={trace} referenceTrace={referenceTrace} trackId={selected.track.id} variant="position" hoverDistance={hover} markers={markers} onMarkerClick={openSectionById} />
                : <div className="ngt-map-empty">{traceLoading ? "Carregando o mapa…" : "Mapa indisponível sem telemetria."}</div>}
            </div>
          </Panel>
        </div>
      )}

      {comparison && <CornerByCorner comparison={comparison} filter={filter} onFilter={(value) => { setFilter(value); setOpenId(null); }} biggestLossId={biggestLossId} onOpen={openSectionById} />}

      {comparison && openSection && trace && referenceTrace && (
        <SectionPopup section={openSection} index={openIndex} total={visibleSections.length} trace={trace} referenceTrace={referenceTrace}
          trackId={selected?.track.id ?? null} trackLengthMeters={trackLength} category={category} isBiggestLoss={openSection.id === biggestLossId}
          onPrev={prev} onNext={next} onClose={closePopup} />
      )}
    </div>
  );
}
