"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, SelectPill } from "@/components/ui";
import SectionPopup from "@/components/telemetry/SectionPopup";
import SectorWinnerMap, { type MapSegment, type OutlinePoint } from "@/components/telemetry/SectorWinnerMap";
import GapEvolutionChart from "@/components/telemetry/GapEvolutionChart";
import { isLossSection, SectionTotalsSummary } from "@/components/telemetry/CornerByCorner";
import { formatLapTime, parseTelemetryCsv, type Trace } from "@/lib/telemetry-trace";
import { compareLaps } from "@/lib/lap-analysis";
import { detectLapCorners } from "@/lib/lap-corners";
import { carNoun, describeSection, formatSignedSeconds } from "@/lib/engineer-talk";
import { countInWindow } from "@/lib/microcorrections";
import { shortCarName } from "@/lib/car-short-name";
import { brakePointText, comparePhrase, lapSpreadText, microFootnote, microTone, sectionMinSpeeds, segmentWins, trackUsageText } from "@/lib/car-compare-talk";
import { trackUiEvent } from "@/lib/track-ui-event";

/**
 * Comparação de carros no Night Grid (redesign etapa 4, 26/09/2026; mockup
 * docs/redesign-mockup/Compare.dc.html). Dados de /api/telemetry/car-comparison (mesmas regras de
 * antes: voltas plausíveis por agrupamento de tempo, GTP separado de GT3, consultas paginadas, GPS
 * verificado), agora com microcorreções por volta. O "Curva a curva" é o mesmo da semana ativa
 * (lib/lap-analysis.ts), agora entre dois carros escolhidos livremente (não mais "seu carro" fixo
 * contra um rival), e cada trecho abre o popup completo da etapa 3. A telemetria das duas voltas vem
 * do endpoint Storage-first de sempre (/api/garage61/laps/:id/telemetry).
 *
 * 29/09/2026: o mapa "Trecho selecionado" (preview ao vivo do trecho com mais perda/foco) saiu da
 * primeira linha -- ele duplicava exatamente o que o popup de cada trecho do curva a curva já mostra
 * (mesmo LapMap, mesmo range), então virou um espaço vazio sem função própria. "Mais rápido por
 * trecho" ocupa esse lugar agora. A escolha dos dois carros comparados também saiu da tabela "Melhor
 * volta por carro" (que só listava/ranqueava, não devia carregar estado de seleção) e virou dois
 * seletores explícitos no painel "Curva a curva", com os dois carros mais rápidos como padrão.
 */
type Category = "gt3" | "gtp";
type SeasonOption = { seasonId: string; seasonName: string };
type TrackOption = { trackId: number; trackName: string; trackVariant: string | null; carCount: number };
type ListPayload = { status: string; seasons: SeasonOption[]; selectedSeasonId: string | null; tracks: TrackOption[]; message?: string };
type Consistency = { stddev: number; label: string } | null;
type InputConsistency = { overall: { score: number; label: string }; channels: { channel: string; name: string; score: number; label: string }[] } | null;
type CarRow = {
  carId: number; carName: string; color: string; bestLapSeconds: number; deltaSeconds: number; avgLapSeconds: number | null;
  lapsAnalyzed: number;
  microcorrections: { laps: number; perLap: number } | null;
  lapTimeConsistency: Consistency; inputConsistency: InputConsistency; trackUsage: { avgPct: number; maxPct: number } | null;
  fastestLap: { id: string; lapSeconds: number; microDistances: number[] };
};
type ComparisonPayload = {
  status: string; message?: string;
  track: { id: number; name: string; variant: string | null } | null;
  cars: CarRow[]; ownCarId: number | null; plausibleLapCount?: number;
  weeks?: { weekNumber: number; lapCount: number }[];
  // Restaurados (auditoria B11): a rota já calculava e a tela nova não mostrava.
  trackOutline?: OutlinePoint[] | null; mapSegments?: MapSegment[]; conditionsNote?: string | null;
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
  const [carAId, setCarAId] = useState<number | null>(null);
  const [carBId, setCarBId] = useState<number | null>(null);
  const [traces, setTraces] = useState<{ own: Trace; rival: Trace; key: string } | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoveredGapSectionId, setHoveredGapSectionId] = useState<string | null>(null);

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
    setCarAId(null);
    setCarBId(null);
    setOpenId(null);
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
  // Padrão: os dois carros mais rápidos (cars[] já vem ordenado por melhor volta) -- livremente
  // trocável por qualquer par através dos dois seletores do painel "Curva a curva".
  const carA = cars.find((car) => car.carId === carAId) ?? cars[0] ?? null;
  const carB = cars.find((car) => car.carId === carBId && car.carId !== carA?.carId) ?? cars.find((car) => car.carId !== carA?.carId) ?? null;
  const nounB = useMemo(() => carNoun(carB ? shortCarName(carB.carName) : "outro carro"), [carB]);
  const nounA = useMemo(() => carNoun(carA ? shortCarName(carA.carName) : "carro"), [carA]);
  const shortA = carA ? shortCarName(carA.carName) : "";
  const shortB = carB ? shortCarName(carB.carName) : "";

  useEffect(() => {
    setTraces(null);
    setTraceError(null);
    setOpenId(null);
    if (!carA || !carB) return;
    const key = `${carA.fastestLap.id}|${carB.fastestLap.id}`;
    let active = true;
    Promise.all([loadTrace(carA.fastestLap.id), loadTrace(carB.fastestLap.id)])
      .then(([ownTrace, rivalTrace]) => { if (active) setTraces({ own: ownTrace, rival: rivalTrace, key }); })
      .catch((reason) => active && setTraceError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [carA, carB]);

  const comparison = useMemo(() => {
    if (!traces || !carA || !data?.track) return null;
    const corners = detectLapCorners(traces.own.points, data.track.name, data.track.variant ?? "");
    return compareLaps(traces.own, traces.rival, carA.fastestLap.lapSeconds, corners);
  }, [traces, carA, data]);

  const sections = useMemo(() => comparison?.sections ?? [], [comparison]);
  const biggestLossId = useMemo(() => {
    const losses = sections.filter(isLossSection);
    return losses.length ? losses.reduce((a, b) => (a.lostSeconds > b.lostSeconds ? a : b)).id : sections[0]?.id ?? null;
  }, [sections]);
  const openIndex = sections.findIndex((section) => section.id === openId);
  const openSection = openIndex >= 0 ? sections[openIndex] : null;
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

  const maxAbs = Math.max(0.01, ...sections.map((section) => Math.abs(section.lostSeconds)));
  const trackLength = comparison?.trackLengthMeters ?? traces?.own.trackLengthMeters ?? null;
  const rows = traces && carA && carB ? sections.map((section) => {
    const speeds = sectionMinSpeeds(traces.own, traces.rival, section);
    const microOwn = countInWindow(carA.fastestLap.microDistances, section.windowStart, section.windowEnd);
    const microRival = countInWindow(carB.fastestLap.microDistances, section.windowStart, section.windowEnd);
    const talk = describeSection(section, { isBiggestLoss: section.id === biggestLossId, ref: nounB, own: nounA });
    return { section, speeds, microOwn, microRival, talk };
  }) : [];
  // Evolução do gap (29/09/2026): saldo da volta inteira e os trechos de maior vantagem/perda,
  // mesma convenção de sinal da lista "Curva a curva" (-section.lostSeconds, positivo = carA à frente).
  const gapKpis = comparison && sections.length ? (() => {
    let maxGain = sections[0];
    let maxLoss = sections[0];
    for (const section of sections) {
      if (section.lostSeconds < maxGain.lostSeconds) maxGain = section;
      if (section.lostSeconds > maxLoss.lostSeconds) maxLoss = section;
    }
    return { finalGap: -comparison.estimatedGap, maxGain, maxLoss };
  })() : null;
  const colorByCar = new Map(cars.map((car) => [car.carId, car.color]));
  const hasSectorMap = !!data?.trackOutline && data.trackOutline.length >= 20 && !!data.mapSegments?.length;
  const wins = segmentWins(data?.mapSegments ?? [], cars.map((car) => car.carId));
  const totalPieces = data?.mapSegments?.length ?? 0;
  const carOptions = cars.map((car) => ({ value: String(car.carId), label: `${car.carName} (${formatLapTime(car.bestLapSeconds)})` }));

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
            <Panel kicker={`Classe ${category === "gtp" ? "GTP" : "GT3"}`} title="Melhor volta por carro">
              <div className="ngc-cars-head" aria-hidden><span>#</span><span>Carro</span><span>Melhor</span><span>Média</span><span>Microcorr./volta</span><span>Delta para o líder</span><span /></div>
              <div className="ngc-cars-list">
                {cars.map((car, index) => {
                  const micro = car.microcorrections?.perLap ?? null;
                  const tone = microTone(micro, minMicro);
                  return (
                    <div key={car.carId} className="ngc-car" role="row">
                      <span className="ngc-car-rank">{index + 1}</span>
                      <span className="ngc-car-name"><span>{car.carName}</span></span>
                      <span className="ngc-car-best">{formatLapTime(car.bestLapSeconds)}</span>
                      <span className="ngc-car-avg">{car.avgLapSeconds !== null ? shortLap(car.avgLapSeconds) : "—"}</span>
                      <span className="ngc-micro"><span className="ngr-track ngr-track-lg"><span className="ngr-fill" data-tone={tone === "none" ? undefined : tone} style={{ display: "block", width: `${micro !== null ? Math.max(6, (micro / maxMicro) * 90) : 0}%` }} /></span><b data-tone={tone}>{micro !== null ? Math.round(micro) : "—"}</b></span>
                      <span className="ngc-lead"><div data-leader={car.deltaSeconds === 0 ? "" : undefined} style={{ width: `${car.deltaSeconds === 0 ? 2 : Math.max(3, (car.deltaSeconds / maxDelta) * 100)}%` }} /></span>
                      <span className="ngc-car-gap">{car.deltaSeconds === 0 ? "líder" : formatSignedSeconds(car.deltaSeconds)}</span>
                    </div>
                  );
                })}
              </div>
              {footnote && <div className="ngc-foot">{footnote}</div>}
              {data?.conditionsNote && <div className="ngc-conditions" role="note">{data.conditionsNote}</div>}
            </Panel>
            {hasSectorMap ? (
              <Panel kicker="Mais rápido por trecho" title="Quem manda em cada pedaço da pista"
                subtitle="Cada pedaço de 5% da volta fica com a cor do carro mais rápido ali, entre todos os carros comparados.">
                <div className="ngc-sector-map">
                  <SectorWinnerMap outline={data!.trackOutline!} segments={data!.mapSegments!} colorByCar={colorByCar} trackId={data?.track?.id ?? null} />
                </div>
                <div className="ngc-wins">
                  {wins.map(({ carId, wins: count }) => {
                    const car = cars.find((item) => item.carId === carId)!;
                    return <span key={carId}><i style={{ background: car.color }} />{shortCarName(car.carName)}<b>{count} de {totalPieces}</b></span>;
                  })}
                </div>
              </Panel>
            ) : (
              <Panel kicker="Mapa" title="Sem mapa por trecho">
                <div className="ngt-state">Trechos comparáveis insuficientes nesta pista para o mapa por trecho.</div>
              </Panel>
            )}
          </div>

          {(comparison || cars.some((car) => car.lapTimeConsistency || car.inputConsistency || car.trackUsage)) && (
            <div className="ngc-extra">
              {comparison && gapKpis && carA && carB && (
                <Panel kicker="Evolução do gap" title="Onde a diferença se abre (ou fecha)"
                  subtitle={`Diferença acumulada entre ${shortA} e ${shortB} ao longo da volta.`}>
                  <div className="ngc-gap-layout">
                    <div className="ngc-gap-kpis">
                      <div className="ngc-gap-pill"><div className="ngc-gap-n" data-tone={gapKpis.finalGap >= 0 ? "gain" : "loss"}>{formatSignedSeconds(gapKpis.finalGap)}</div><div className="ngc-gap-l">saldo final da volta</div></div>
                      <div className="ngc-gap-pill"><div className="ngc-gap-n" data-tone="gain">{formatSignedSeconds(-gapKpis.maxGain.lostSeconds)}</div><div className="ngc-gap-l">maior vantagem ({gapKpis.maxGain.label})</div></div>
                      <div className="ngc-gap-pill"><div className="ngc-gap-n" data-tone="loss">{formatSignedSeconds(-gapKpis.maxLoss.lostSeconds)}</div><div className="ngc-gap-l">maior perda ({gapKpis.maxLoss.label})</div></div>
                      <div className="ngc-gap-legend">
                        <span><i style={{ background: "var(--ng-text)" }} />Gap acumulado</span>
                        <span><i style={{ background: "var(--ng-gain)" }} />Ganhando</span>
                        <span><i style={{ background: "var(--ng-loss)" }} />Perdendo</span>
                      </div>
                      <div className="ngc-gap-kpis-spacer" />
                    </div>
                    <div className="ngc-gap-chart-col">
                      <GapEvolutionChart grid={comparison.grid} rows={rows} hoveredSectionId={hoveredGapSectionId}
                        onHoverSection={setHoveredGapSectionId}
                        onOpenSection={(id) => { setOpenId(id); trackUiEvent("telemetry_opportunity_opened", { carId: carA.carId, trackId: data?.track?.id, category: "gap_evolution", tab: "cars" }); }} />
                      <div className="ngc-gap-hint">Passe o mouse num ponto da linha pra ver o trecho · clique pra abrir a análise completa.</div>
                    </div>
                  </div>
                </Panel>
              )}
              <Panel kicker="Consistência por carro" title="Quanto cada carro repete e quanto usa da pista"
                subtitle="Nas voltas plausíveis de cada carro: variação do tempo de volta, dos pedais e do volante, e quanto da largura da pista a volta usa.">
                <div className="ngc-cons" role="table" aria-label="Consistência e uso da pista por carro">
                  <div className="ngc-cons-head" role="row"><span role="columnheader">Carro</span><span role="columnheader">Tempo de volta</span><span role="columnheader">Pedais e volante</span><span role="columnheader">Uso da pista</span></div>
                  {cars.map((car) => (
                    <div key={car.carId} className="ngc-cons-row" role="row" data-own={car.carId === carA?.carId || car.carId === carB?.carId ? "" : undefined}>
                      <span role="cell" className="ngc-cons-car"><i style={{ background: car.color }} />{shortCarName(car.carName)}</span>
                      <span role="cell">{lapSpreadText(car.lapTimeConsistency)}</span>
                      <span role="cell">{car.inputConsistency ? (
                        <><b>{car.inputConsistency.overall.label}</b><em>{car.inputConsistency.channels.map((channel) => `${channel.name.toLowerCase()} ${channel.label}`).join(" · ")}</em></>
                      ) : "poucas voltas com telemetria"}</span>
                      <span role="cell">{trackUsageText(car.trackUsage)}</span>
                    </div>
                  ))}
                </div>
                <div className="ngc-foot">Uso da pista: 0% é andar sempre no meio, 100% é colar na borda (acima de 100% passa da borda marcada no mapa).</div>
                <div className="ngc-cons-spacer" />
              </Panel>
            </div>
          )}

          {carA && carB && (
            <Panel kicker="Curva a curva" title={`${carA.carName} × ${carB.carName}`}
              subtitle="O mesmo curva a curva do Telemetry Lab, agora entre os dois carros escolhidos abaixo. Sequências são analisadas juntas."
              actions={
                <div className="ngc-pair-picker">
                  <SelectPill ariaLabel="Carro A" label="Carro A" value={carA ? String(carA.carId) : ""} options={carOptions} onChange={(value) => setCarAId(Number(value))} />
                  <SelectPill ariaLabel="Carro B" label="Carro B" value={carB ? String(carB.carId) : ""} options={carOptions.filter((option) => option.value !== String(carA?.carId))} onChange={(value) => setCarBId(Number(value))} />
                  <span className="ngr-note">Clique num trecho para abrir a análise completa →</span>
                </div>
              }>
              {traceError ? <div className="ngr-empty">{traceError}</div>
                : !comparison ? <div className="ngr-empty">{traces ? "Não foi possível alinhar as duas voltas." : "Carregando a telemetria das duas voltas mais rápidas…"}</div>
                  : (
                    <>
                      <SectionTotalsSummary comparison={comparison} against={nounB.sub} />
                      <div className="ngc-rows-head" aria-hidden><span>Trecho</span><span><span>Perde</span><span>Ganha</span></span><span>Tempo</span><span>Vel. mínima ({shortA} / {shortB})</span><span>Microcorr. ({shortA} / {shortB})</span><span>Ponto de freio</span><span>Em uma frase</span></div>
                      {rows.map(({ section, speeds, microOwn, microRival, talk }, rowIndex) => {
                        const loss = isLossSection(section);
                        const width = Math.max((Math.abs(section.lostSeconds) / maxAbs) * 48, 2);
                        const phrase = comparePhrase(talk.note, microOwn, microRival, nounA, nounB, rowIndex);
                        return (
                          <button key={section.id} type="button" className="ngc-row" data-tone={loss ? "loss" : "gain"}
                            aria-label={`${section.label}: ${formatSignedSeconds(-section.lostSeconds)}. ${phrase} Abrir detalhe.`}
                            onClick={() => { setOpenId(section.id); trackUiEvent("telemetry_opportunity_opened", { carId: carA.carId, trackId: data?.track?.id, category: section.isSequence ? "sequence" : "corner", tab: "cars" }); }}>
                            <div><div className="ngt-row-name">{section.label}</div><div className="ngt-row-range">{section.isSequence ? "sequência" : "curva única"}</div></div>
                            <div className="ngt-bar" aria-hidden><div className="ngt-bar-axis" /><div className="ngt-bar-fill" style={{ left: loss ? `${50 - width}%` : "50%", width: `${width}%` }} /></div>
                            <div className="ngt-row-dt">{formatSignedSeconds(-section.lostSeconds)}</div>
                            <div className="ngc-cell">{speeds.own !== null && speeds.rival !== null ? `${Math.round(speeds.own)} / ${Math.round(speeds.rival)} km/h` : "—"}</div>
                            <div className="ngc-cell">{microOwn} / {microRival}</div>
                            <div className="ngc-cell">{brakePointText(section.metrics, nounA, nounB)}</div>
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

      {comparison && openSection && traces && carB && (
        <SectionPopup section={openSection} index={openIndex} total={sections.length} trace={traces.own} referenceTrace={traces.rival}
          trackId={data?.track?.id ?? null} trackLengthMeters={trackLength} category="sports" isBiggestLoss={openSection.id === biggestLossId}
          ownNoun={nounA} ownLabel={shortA} refNoun={nounB} refLabel={shortB} onPrev={prev} onNext={next} onClose={closePopup} />
      )}
    </div>
  );
}
