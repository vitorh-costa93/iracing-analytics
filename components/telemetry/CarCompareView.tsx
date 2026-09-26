"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chip, Panel, SelectPill } from "@/components/ui";
import LapMap from "@/components/telemetry/LapMap";
import SectionPopup from "@/components/telemetry/SectionPopup";
import { isLossSection } from "@/components/telemetry/CornerByCorner";
import { formatLapTime, parseTelemetryCsv, type Trace } from "@/lib/telemetry-trace";
import { compareLaps } from "@/lib/lap-analysis";
import { detectLapCorners } from "@/lib/lap-corners";
import { carNoun, describeSection, formatSeconds, formatSignedSeconds } from "@/lib/engineer-talk";
import { countInWindow } from "@/lib/microcorrections";
import { shortCarName } from "@/lib/car-short-name";
import { brakePointText, comparePhrase, mapCaption, microFootnote, microTone, sectionMinSpeeds } from "@/lib/car-compare-talk";
import { trackUiEvent } from "@/lib/track-ui-event";

/**
 * Comparação de carros no Night Grid (redesign etapa 4, 26/09/2026; mockup
 * docs/redesign-mockup/Compare.dc.html). Dados de /api/telemetry/car-comparison (mesmas regras de
 * antes: voltas plausíveis por agrupamento de tempo, GTP separado de GT3, consultas paginadas, GPS
 * verificado), agora com microcorreções por volta. O "Curva a curva" é o mesmo da semana ativa
 * (lib/lap-analysis.ts), você contra o carro escolhido, e cada trecho abre o popup completo da etapa 3.
 * A telemetria das duas voltas vem do endpoint Storage-first de sempre (/api/garage61/laps/:id/telemetry).
 */
type Category = "gt3" | "gtp";
type SeasonOption = { seasonId: string; seasonName: string };
type TrackOption = { trackId: number; trackName: string; trackVariant: string | null; carCount: number };
type ListPayload = { status: string; seasons: SeasonOption[]; selectedSeasonId: string | null; tracks: TrackOption[]; message?: string };
type CarRow = {
  carId: number; carName: string; bestLapSeconds: number; deltaSeconds: number; avgLapSeconds: number | null;
  microcorrections: { laps: number; perLap: number; perMinute: number } | null;
  fastestLap: { id: string; lapSeconds: number; microDistances: number[] };
};
type ComparisonPayload = {
  status: string; message?: string;
  track: { id: number; name: string; variant: string | null } | null;
  cars: CarRow[]; ownCarId: number | null; plausibleLapCount?: number;
  weeks?: { weekNumber: number; lapCount: number }[];
};

const CLASS_OPTIONS = [{ value: "gt3" as const, label: "GT3" }, { value: "gtp" as const, label: "IMSA · GTP" }];

function shortLap(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

async function loadTrace(lapId: string) {
  const response = await fetch(`/api/garage61/laps/${encodeURIComponent(lapId)}/telemetry`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error("A telemetria da volta mais rápida de um dos carros ainda não foi trazida para o app. Use \"Atualizar dados\" no cabeçalho para buscá-la.");
  return parseTelemetryCsv(text);
}

export default function CarCompareView() {
  const [category, setCategory] = useState<Category>("gt3");
  const [season, setSeason] = useState("auto");
  const [week, setWeek] = useState("all");
  const [list, setList] = useState<ListPayload | null>(null);
  const [trackId, setTrackId] = useState<number | null>(null);
  const [data, setData] = useState<ComparisonPayload | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rivalId, setRivalId] = useState<number | null>(null);
  const [traces, setTraces] = useState<{ own: Trace; rival: Trace; key: string } | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingList(true);
    setError(null);
    fetch(`/api/telemetry/car-comparison?category=${category}${season !== "auto" ? `&season=${season}` : ""}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: ListPayload) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao buscar temporadas e pistas");
        setList(result);
        if (season === "auto" && result.selectedSeasonId) setSeason(result.selectedSeasonId);
        setTrackId((current) => (current !== null && result.tracks.some((track) => track.trackId === current) ? current : result.tracks[0]?.trackId ?? null));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingList(false));
    return () => { active = false; };
  }, [category, season]);

  useEffect(() => { setWeek("all"); }, [trackId, season]);

  useEffect(() => {
    setData(null);
    setRivalId(null);
    setOpenId(null);
    setFocusId(null);
    if (trackId === null) return;
    let active = true;
    setLoadingData(true);
    fetch(`/api/telemetry/car-comparison?trackId=${trackId}&category=${category}&compact=1${season !== "auto" ? `&season=${season}` : ""}${week !== "all" ? `&week=${week}` : ""}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: ComparisonPayload) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao comparar carros");
        setData(result);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoadingData(false));
    return () => { active = false; };
  }, [trackId, category, season, week]);

  const cars = useMemo(() => data?.cars ?? [], [data]);
  const own = cars.find((car) => car.carId === data?.ownCarId) ?? cars[0] ?? null;
  const defaultRival = own ? (cars[0]?.carId !== own.carId ? cars[0] : cars[1]) ?? null : null;
  const rival = cars.find((car) => car.carId === rivalId && car.carId !== own?.carId) ?? defaultRival;
  const ref = useMemo(() => carNoun(rival ? shortCarName(rival.carName) : "outro carro"), [rival]);

  useEffect(() => {
    setTraces(null);
    setTraceError(null);
    setOpenId(null);
    if (!own || !rival) return;
    const key = `${own.fastestLap.id}|${rival.fastestLap.id}`;
    let active = true;
    Promise.all([loadTrace(own.fastestLap.id), loadTrace(rival.fastestLap.id)])
      .then(([ownTrace, rivalTrace]) => { if (active) setTraces({ own: ownTrace, rival: rivalTrace, key }); })
      .catch((reason) => active && setTraceError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [own, rival]);

  const comparison = useMemo(() => {
    if (!traces || !own || !data?.track) return null;
    const corners = detectLapCorners(traces.own.points, data.track.name, data.track.variant ?? "");
    return compareLaps(traces.own, traces.rival, own.fastestLap.lapSeconds, corners);
  }, [traces, own, data]);

  const sections = useMemo(() => comparison?.sections ?? [], [comparison]);
  const biggestLossId = useMemo(() => {
    const losses = sections.filter(isLossSection);
    return losses.length ? losses.reduce((a, b) => (a.lostSeconds > b.lostSeconds ? a : b)).id : sections[0]?.id ?? null;
  }, [sections]);
  const openIndex = sections.findIndex((section) => section.id === openId);
  const openSection = openIndex >= 0 ? sections[openIndex] : null;
  const mapSection = sections.find((section) => section.id === (focusId ?? biggestLossId)) ?? null;
  const closePopup = useCallback(() => setOpenId(null), []);
  const prev = useCallback(() => { if (openIndex > 0) setOpenId(sections[openIndex - 1].id); }, [openIndex, sections]);
  const next = useCallback(() => { if (openIndex >= 0 && openIndex < sections.length - 1) setOpenId(sections[openIndex + 1].id); }, [openIndex, sections]);

  if (loadingList && !list) return <div className="ngt-state">Buscando temporadas e pistas onde você andou com mais de um carro…</div>;
  if (error && !data) return <div className="ngt-state" data-tone="error">{error}</div>;

  const seasonValue = season === "auto" ? list?.selectedSeasonId ?? "all" : season;
  const seasonOptions = [...(list?.seasons ?? []).map((item) => ({ value: item.seasonId, label: item.seasonName })), { value: "all", label: "Todas as temporadas" }];
  const trackOptions = (list?.tracks ?? []).map((track) => ({ value: String(track.trackId), label: `${track.trackName}${track.trackVariant ? ` (${track.trackVariant})` : ""}` }));
  const minMicro = cars.reduce<number | null>((min, car) => (car.microcorrections ? (min === null ? car.microcorrections.perLap : Math.min(min, car.microcorrections.perLap)) : min), null);
  const maxMicro = Math.max(1, ...cars.map((car) => car.microcorrections?.perLap ?? 0));
  const maxDelta = Math.max(0.5, ...cars.map((car) => car.deltaSeconds)) * 1.03;
  const footnote = microFootnote(cars.map((car) => ({ carName: car.carName, bestLapSeconds: car.bestLapSeconds, microPerLap: car.microcorrections?.perLap ?? null })), shortCarName);

  const losses = sections.filter(isLossSection);
  const gains = sections.filter((section) => !isLossSection(section));
  const lost = losses.reduce((sum, section) => sum + section.lostSeconds, 0);
  const gained = gains.reduce((sum, section) => sum - section.lostSeconds, 0);
  const maxAbs = Math.max(0.01, ...sections.map((section) => Math.abs(section.lostSeconds)));
  const trackLength = comparison?.trackLengthMeters ?? traces?.own.trackLengthMeters ?? null;
  const rows = traces && own && rival ? sections.map((section) => {
    const speeds = sectionMinSpeeds(traces.own, traces.rival, section);
    const microOwn = countInWindow(own.fastestLap.microDistances, section.windowStart, section.windowEnd);
    const microRival = countInWindow(rival.fastestLap.microDistances, section.windowStart, section.windowEnd);
    const talk = describeSection(section, { isBiggestLoss: section.id === biggestLossId, ref });
    return { section, speeds, microOwn, microRival, talk };
  }) : [];
  const mapRow = rows.find((row) => row.section.id === mapSection?.id) ?? null;
  const rivalShort = rival ? shortCarName(rival.carName) : "";

  return (
    <div className="ngc-screen">
      <div className="ngc-toolbar">
        <SelectPill ariaLabel="Temporada" value={seasonValue} options={seasonOptions} onChange={(value) => setSeason(value)} />
        <SelectPill ariaLabel="Pista" value={trackId !== null ? String(trackId) : ""} disabled={!trackOptions.length}
          options={trackOptions.length ? trackOptions : [{ value: "", label: "Nenhuma pista com 2 carros" }]} onChange={(value) => setTrackId(Number(value))} />
        <SelectPill ariaLabel="Classe" value={category} options={CLASS_OPTIONS} onChange={(value) => { setCategory(value); setSeason("auto"); setTrackId(null); }} />
        {!!data?.weeks && data.weeks.length > 1 && (
          <SelectPill ariaLabel="Semana" value={week} onChange={setWeek}
            options={[{ value: "all", label: "Todas as semanas" }, ...data.weeks.map((item) => ({ value: String(item.weekNumber), label: `Semana ${item.weekNumber} · ${item.lapCount} voltas` }))]} />
        )}
        <div className="ngr-spacer" />
        {cars.length > 0 && <div className="ngr-hint">Só voltas plausíveis (agrupamento por tempo) · {data?.plausibleLapCount ?? 0} voltas · {cars.length} carros</div>}
      </div>

      {!trackOptions.length ? (
        <div className="ngt-state">Nenhuma pista com voltas válidas de dois ou mais carros de {category === "gtp" ? "GTP" : "GT3"} {seasonValue !== "all" ? "nesta temporada" : "ainda"}.{seasonValue !== "all" && <button type="button" className="ngt-link-button" onClick={() => setSeason("all")}>Ver todas as temporadas</button>}</div>
      ) : loadingData ? (
        <div className="ngt-state">Separando as voltas plausíveis de cada carro e conferindo o GPS…</div>
      ) : !cars.length ? (
        <div className="ngt-state">{data?.message ?? error ?? "Sem dados suficientes para essa pista."}</div>
      ) : (
        <>
          <div className="ngc-top">
            <Panel className="ngc-h430" kicker={`Classe ${category === "gtp" ? "GTP" : "GT3"}`} title="Melhor volta por carro">
              <div className="ngc-cars-head" aria-hidden><span>#</span><span>Carro</span><span>Melhor</span><span>Média</span><span>Microcorr./volta</span><span>Delta para o líder</span><span /></div>
              <div className="ngc-cars-list">
                {cars.map((car, index) => {
                  const isOwn = car.carId === own?.carId;
                  const micro = car.microcorrections?.perLap ?? null;
                  const tone = microTone(micro, minMicro);
                  return (
                    <button key={car.carId} type="button" className="ngc-car" data-own={isOwn ? "" : undefined} aria-pressed={car.carId === rival?.carId}
                      title={isOwn ? "Seu carro" : `Comparar curva a curva com o ${shortCarName(car.carName)}`}
                      onClick={() => { if (!isOwn) setRivalId(car.carId); }}>
                      <span className="ngc-car-rank">{index + 1}</span>
                      <span className="ngc-car-name"><span>{car.carName}</span>{isOwn && <Chip tone="brand">seu carro</Chip>}</span>
                      <span className="ngc-car-best">{formatLapTime(car.bestLapSeconds)}</span>
                      <span className="ngc-car-avg">{car.avgLapSeconds !== null ? shortLap(car.avgLapSeconds) : "—"}</span>
                      <span className="ngc-micro"><span className="ngr-track ngr-track-lg"><span className="ngr-fill" data-tone={tone === "none" ? undefined : tone} style={{ display: "block", width: `${micro !== null ? Math.max(6, (micro / maxMicro) * 90) : 0}%` }} /></span><b data-tone={tone}>{micro !== null ? Math.round(micro) : "—"}</b></span>
                      <span className="ngc-lead"><div data-leader={car.deltaSeconds === 0 ? "" : undefined} style={{ width: `${car.deltaSeconds === 0 ? 2 : Math.max(3, (car.deltaSeconds / maxDelta) * 100)}%` }} /></span>
                      <span className="ngc-car-gap">{car.deltaSeconds === 0 ? "líder" : formatSignedSeconds(car.deltaSeconds)}</span>
                    </button>
                  );
                })}
              </div>
              {footnote && <div className="ngc-foot">{footnote}</div>}
            </Panel>
            <Panel className="ngc-h430" kicker="Mapa" title="Trecho selecionado" subtitle="Região local, não o circuito inteiro"
              actions={rival ? <div className="ngc-legend"><span><i />Você</span><span><i data-line="rival" />{rivalShort}</span></div> : undefined}>
              <div className="ngc-map">
                {traces && mapSection ? <LapMap trace={traces.own} referenceTrace={traces.rival} trackId={data?.track?.id ?? null} variant="popup" range={[mapSection.windowStart, mapSection.windowEnd]} width={380} height={250} />
                  : <div className="ngt-map-empty">{traceError ?? (rival ? "Carregando o traçado dos dois carros…" : "Escolha um carro para comparar.")}</div>}
              </div>
              {mapRow && <div className="ngr-note">{mapCaption(mapRow.section.label, mapRow.speeds, ref, mapRow.talk.note)}</div>}
            </Panel>
          </div>

          {own && rival && (
            <Panel kicker="Curva a curva" title={`Você × ${rival.carName}`}
              subtitle="O mesmo curva a curva do Telemetry Lab, agora contra o carro escolhido. Sequências são analisadas juntas."
              actions={<span className="ngr-note">Clique num trecho para abrir a análise completa →</span>}>
              {traceError ? <div className="ngr-empty">{traceError}</div>
                : !comparison ? <div className="ngr-empty">{traces ? "Não foi possível alinhar as duas voltas." : "Carregando a telemetria das duas voltas mais rápidas…"}</div>
                  : (
                    <>
                      <div className="ngt-summary">
                        <div><strong data-tone="loss">{formatSeconds(lost)}</strong><span>perdidos em {losses.length} {losses.length === 1 ? "trecho" : "trechos"}</span></div>
                        <div><strong data-tone="gain">{formatSeconds(Math.max(0, gained))}</strong><span>ganhos em {gains.length} {gains.length === 1 ? "trecho" : "trechos"}</span></div>
                        <div><strong>{formatSignedSeconds(gained - lost)}</strong><span>no total dos trechos · o resto está nas retas</span></div>
                      </div>
                      <div className="ngc-rows-head" aria-hidden><span>Trecho</span><span><span>Perde</span><span>Ganha</span></span><span>Tempo</span><span>Vel. mínima (você / ele)</span><span>Microcorr. (você / ele)</span><span>Ponto de freio</span><span>Em uma frase</span></div>
                      {rows.map(({ section, speeds, microOwn, microRival, talk }, rowIndex) => {
                        const loss = isLossSection(section);
                        const width = Math.max((Math.abs(section.lostSeconds) / maxAbs) * 48, 2);
                        const phrase = comparePhrase(talk.note, microOwn, microRival, rowIndex);
                        return (
                          <button key={section.id} type="button" className="ngc-row" data-tone={loss ? "loss" : "gain"} aria-current={section.id === mapSection?.id ? "true" : undefined}
                            aria-label={`${section.label}: ${formatSignedSeconds(-section.lostSeconds)}. ${phrase} Abrir detalhe.`}
                            onMouseEnter={() => setFocusId(section.id)} onFocus={() => setFocusId(section.id)}
                            onClick={() => { setOpenId(section.id); trackUiEvent("telemetry_opportunity_opened", { carId: own.carId, trackId: data?.track?.id, category: section.isSequence ? "sequence" : "corner", tab: "cars" }); }}>
                            <div><div className="ngt-row-name">{section.label}</div><div className="ngt-row-range">{section.isSequence ? "sequência" : "curva única"}</div></div>
                            <div className="ngt-bar" aria-hidden><div className="ngt-bar-axis" /><div className="ngt-bar-fill" style={{ left: loss ? `${50 - width}%` : "50%", width: `${width}%` }} /></div>
                            <div className="ngt-row-dt">{formatSignedSeconds(-section.lostSeconds)}</div>
                            <div className="ngc-cell">{speeds.own !== null && speeds.rival !== null ? `${Math.round(speeds.own)} / ${Math.round(speeds.rival)} km/h` : "—"}</div>
                            <div className="ngc-cell">{microOwn} / {microRival}</div>
                            <div className="ngc-cell">{brakePointText(section.metrics)}</div>
                            <div className="ngc-phrase">{phrase}</div>
                          </button>
                        );
                      })}
                    </>
                  )}
            </Panel>
          )}
        </>
      )}

      {comparison && openSection && traces && rival && (
        <SectionPopup section={openSection} index={openIndex} total={sections.length} trace={traces.own} referenceTrace={traces.rival}
          trackId={data?.track?.id ?? null} trackLengthMeters={trackLength} category="sports" isBiggestLoss={openSection.id === biggestLossId}
          refNoun={ref} refLabel={rivalShort} onPrev={prev} onNext={next} onClose={closePopup} />
      )}
    </div>
  );
}
