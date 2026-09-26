"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Chip, Panel, PageTitle, SegmentedControl } from "@/components/ui";
import type { ChipTone } from "@/components/ui";
import type { DebriefRaceRow, DebriefReport, DebriefSection, PedalSet } from "@/lib/debrief-types";
import { dec, plural, signedInt } from "@/lib/debrief-narrative";
import { DivergingRow, LossTimingBars, PaceScatter, WeekPressureBars } from "./DebriefCharts";

type Scope = "week" | "season";
type Segment = "formula" | "gt3" | "imsa";

// Versão do cache local: v6 desde 25/09/2026 (contrato novo em lib/debrief-types.ts). Suba ao mudar a
// forma do payload, para nenhum navegador carregar um payload antigo direto no estado (bug de 08/09).
const CACHE_VERSION = "iracing-debrief-v6-";
const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: "formula", label: "Super Formula" },
  { value: "gt3", label: "GT3" },
  { value: "imsa", label: "IMSA" },
];
const CONFIDENCE: Record<DebriefSection["confidence"], { label: string; tone: ChipTone }> = {
  alta: { label: "confiança boa", tone: "gain" },
  "média": { label: "confiança média", tone: "formula" },
  baixa: { label: "confiança baixa", tone: "loss" },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const toneOf = (value: number) => (value > 0 ? "gain" : value < 0 ? "loss" : "neutral");

export default function DebriefsView({ initialScope, initialSegment }: { initialScope: Scope; initialSegment: Segment }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(initialScope);
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const [report, setReport] = useState<DebriefReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [retry, setRetry] = useState(0);

  const change = (nextScope: Scope, nextSegment: Segment) => {
    setScope(nextScope);
    setSegment(nextSegment);
    router.replace("/debriefs?scope=" + nextScope + (nextSegment === "formula" ? "" : "&segment=" + nextSegment), { scroll: false });
  };

  useEffect(() => {
    let dead = false;
    const cacheKey = CACHE_VERSION + scope + "-" + segment;
    let hadCache = false;
    setError(null);
    setSlow(false);
    try {
      const cached = window.localStorage.getItem(cacheKey);
      const parsed = cached ? (JSON.parse(cached) as DebriefReport) : null;
      hadCache = !!parsed;
      setReport(parsed);
    } catch { setReport(null); }
    const slowTimer = window.setTimeout(() => { if (!dead) setSlow(true); }, 6000);
    fetch("/api/dashboard/report?scope=" + scope + "&segment=" + segment, { cache: retry ? "no-store" : "default" })
      .then(async (response) => {
        const raw = await response.text();
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw new Error("O servidor não conseguiu concluir a análise desta vez."); }
        if (!response.ok) throw new Error(data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "Não foi possível montar o debrief.");
        return data as DebriefReport;
      })
      .then((data) => {
        if (dead) return;
        setReport(data);
        setSlow(false);
        try { window.localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* sem espaço: segue sem cache */ }
      })
      .catch(() => {
        if (dead) return;
        setError(hadCache ? "A atualização falhou; mostrando a última análise salva." : "A análise demorou mais que o esperado e não foi concluída.");
        setSlow(false);
      })
      .finally(() => window.clearTimeout(slowTimer));
    return () => { dead = true; window.clearTimeout(slowTimer); };
  }, [scope, segment, retry]);

  const section = report?.sections.find((item) => item.segment === segment) ?? null;
  const eyebrow = scope === "season"
    ? "Race Engineer · " + (report ? report.seasonName + " vs. " + report.previousSeasonName : "season atual vs. anterior")
    : "Race Engineer · " + (section?.week ? "Week " + section.week : "week atual") + " vs. demais weeks";

  return (
    <div className="ng-page">
      <main className="ng-main ngd-main">
        <PageTitle
          eyebrow={eyebrow}
          title={scope === "season" ? "Debrief da season" : "Debrief da week"}
          aside={
            <div className="ngd-toggles">
              <SegmentedControl ariaLabel="Segmento" options={SEGMENTS} value={segment} onChange={(value) => change(scope, value)} />
              <div className="ngd-spacer" />
              <SegmentedControl ariaLabel="Recorte" options={[{ value: "week", label: "Da semana" }, { value: "season", label: "Da season" }]} value={scope} onChange={(value) => change(value as Scope, segment)} />
            </div>
          }
        />
        {error && (
          <div className="ngd-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar de novo</button>
          </div>
        )}
        {!section && !error && (
          <Panel><div className="ngd-empty">{slow ? "Ainda cruzando resultados e telemetria das duas seasons. A primeira análise pode levar alguns segundos." : "Montando o debrief…"}</div></Panel>
        )}
        {section && <Debrief section={section} scope={scope} referenceLabel={scope === "season" ? report!.previousSeasonName : "demais weeks"} />}
      </main>
    </div>
  );
}

function Debrief({ section, scope, referenceLabel }: { section: DebriefSection; scope: Scope; referenceLabel: string }) {
  const { kpis, narrative } = section;
  if (!section.races) {
    return <Panel><div className="ngd-empty">{narrative.summary}</div></Panel>;
  }
  const confidence = CONFIDENCE[section.confidence];
  const refLegend = scope === "season" ? "season anterior" : "demais weeks";
  const impactMax = Math.max(1, ...section.impactRaces.map((race) => Math.abs(race.delta)));
  const raceMax = Math.max(1, ...section.raceList.map((race) => Math.abs(race.delta)));
  const contextRows = [...section.contexts.losses, ...section.contexts.gains];
  const contextMax = Math.max(1, ...contextRows.map((row) => Math.abs(row.delta)));
  const incidentTone = kpis.incidentsAvg === null || kpis.incidentsRef === null ? "neutral" : kpis.incidentsAvg <= kpis.incidentsRef ? "gain" : kpis.incidentsAvg - kpis.incidentsRef >= 0.5 ? "loss" : "neutral";
  const streak = kpis.streak;
  return (
    <>
      <section className="ng-panel ngd-quick" aria-label="Leitura rápida">
        <div className="ngd-quick-head">
          <div className="ngd-quick-kicker">LEITURA RÁPIDA</div>
          <Chip tone={confidence.tone}>amostra: {plural(section.races, "corrida", "corridas")} · {confidence.label}</Chip>
        </div>
        <p className="ngd-quick-summary">{narrative.summary}</p>
        <p className="ngd-quick-pace"><strong>Ritmo e resultado:</strong> {narrative.paceVsResult}</p>
        <div className="ngd-quick-action"><span>O QUE FAZER</span><p>{narrative.action}</p></div>
      </section>

      <section className="ngd-kpis" aria-label="Indicadores">
        <Kpi label="Saldo de iRating" value={signedInt(kpis.net)} tone={toneOf(kpis.net)}
          sub={kpis.referenceNet === null ? "sem referência" : scope === "season" ? "vs. " + referenceLabel + ": " + signedInt(kpis.referenceNet) : "média das outras: " + signedInt(kpis.referenceNet) + "/corrida"} />
        <Kpi label="Perdas grandes" value={String(kpis.severeCount)} tone={kpis.severeCount ? "loss" : "gain"} sub={"mais de " + kpis.severeThreshold + " pontos numa corrida"} />
        <Kpi label="Abandonos" value={String(kpis.retirements)} tone="neutral" sub={kpis.retirements ? (kpis.retirementRate ?? 0) + "% das corridas" : scope === "week" ? "nenhum na week" : "nenhum na season"} />
        <Kpi label="Incidentes" value={kpis.incidentsAvg === null ? "—" : dec(kpis.incidentsAvg) + " / corrida"} tone={incidentTone} sub={kpis.incidentsRef === null ? "sem referência" : "referência: " + dec(kpis.incidentsRef)} />
        <Kpi label="Sequência" value={streak.direction ? streak.length + (streak.direction === "gain" ? " ↑" : " ↓") : "0"} tone={streak.direction === "gain" ? "gain" : streak.direction === "loss" ? "loss" : "neutral"}
          sub={(streak.direction === "gain" ? "ganhando iRating" : streak.direction === "loss" ? "perdendo iRating" : "sem sequência aberta") + " · recorde " + streak.recordGain} />
      </section>

      <div className="ngd-row-2">
        <Panel kicker="NOVO · RITMO × RESULTADO" title="Você foi rápido, mas perdeu iRating?" className="ngd-h340"
          subtitle={(scope === "season" ? "Cada ponto é uma week" : "Cada ponto é uma corrida") + ": quanto sua melhor volta ficou da referência, contra o iRating ganho"}>
          {section.pace.points.length ? <PaceScatter pace={section.pace} /> : <div className="ngd-empty">Sem volta de corrida registrada para montar o gráfico.</div>}
        </Panel>
        <Panel kicker="NOVO · QUANDO AS PERDAS ACONTECEM" title="Em que ponto da corrida você perde" className="ngd-h340"
          subtitle="Quanto da corrida já tinha passado quando a perda grande aconteceu"
          actions={<div className="ngd-legend"><span data-kind="now">■ agora</span><span data-kind="ref">■ {refLegend}</span></div>}>
          <LossTimingBars current={section.lossTiming.current} reference={section.lossTiming.reference} referenceLabel={refLegend} />
          <p className="ngd-note">{narrative.lossTiming.before}{narrative.lossTiming.strong && <strong>{narrative.lossTiming.strong}</strong>}{narrative.lossTiming.after}</p>
        </Panel>
      </div>

      <div className="ngd-row-2 ngd-row-even">
        {scope === "season" ? (
          <Panel kicker="PRESSÃO POR WEEK" title="Como cada week fechou o iRating" subtitle={narrative.trendSubtitle} className="ngd-h270">
            <WeekPressureBars weeks={section.weeks} />
          </Panel>
        ) : (
          <Panel kicker="CORRIDAS DA WEEK" title="O que cada corrida rendeu" subtitle={narrative.trendSubtitle} className="ngd-h270">
            <div className="ngd-scroll">
              {section.raceList.map((race) => (
                <DivergingRow key={race.date + race.track} title={shortDate(race.date) + " · " + race.track} subtitle={"largou P" + (race.grid ?? "—") + " · chegou P" + race.finish + (race.sof ? " · SoF " + race.sof : "")} value={race.delta} max={raceMax} valueText={signedInt(race.delta)} />
              ))}
            </div>
          </Panel>
        )}
        <Panel kicker="CORRIDAS DE MAIOR IMPACTO" title="As que mais mexeram no seu iRating" className="ngd-h270">
          <div className="ngd-scroll">
            {section.impactRaces.map((race) => <DivergingRow key={race.date + race.track} title={shortDate(race.date) + " · " + race.track} subtitle={impactSubtitle(race)} value={race.delta} max={impactMax} valueText={signedInt(race.delta)} />)}
          </div>
        </Panel>
      </div>

      <div className="ngd-row-2 ngd-row-even">
        <Panel kicker="CONTEXTOS" title="Onde você perde e onde você sustenta ganhos">
          {contextRows.length ? contextRows.map((row) => (
            <DivergingRow key={row.track + row.car} title={row.track} subtitle={plural(row.races, "corrida", "corridas") + " · " + row.car} value={row.delta} max={contextMax} valueText={signedInt(row.delta)} />
          )) : <div className="ngd-empty">Sem contextos suficientes.</div>}
        </Panel>
        <Evidence section={section} referenceLabel={scope === "season" ? "Season anterior" : "Demais weeks"} />
      </div>
    </>
  );
}

function impactSubtitle(race: DebriefRaceRow) {
  return "P" + (race.grid ?? "—") + " → P" + race.finish + (race.sof ? " · SoF " + race.sof : "") + (race.lossShare ? " · " + race.lossShare + "% das perdas" : "");
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "gain" | "loss" | "neutral" }) {
  return (
    <div className="ngd-kpi">
      <div className="ngd-kpi-label">{label}</div>
      <div className="ngd-kpi-value" data-tone={tone}>{value}</div>
      <div className="ngd-kpi-sub">{sub}</div>
    </div>
  );
}

const pedalText = (set: PedalSet) => {
  const parts = [["freio", set.brake], ["acelerador", set.throttle], ["volante", set.steering]].filter((item): item is [string, number] => item[1] !== null);
  return parts.length ? parts.map(([name, value]) => name + " " + value + "%").join(" · ") : null;
};

function Evidence({ section, referenceLabel }: { section: DebriefSection; referenceLabel: string }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => { setOpen(new Set([0])); }, [section.segment, section.week]);
  const { incidents, retirements, pedals, streaks, method } = section.evidence;
  const toggle = (index: number) => setOpen((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const confirmed = retirements.items.filter((item) => item.confidence !== "probable").length;
  const items: Array<{ title: string; summary: string; body: ReactNode }> = [
    {
      title: "Incidentes por corrida",
      summary: incidents.current.average === null ? "sem dado" : "média " + dec(incidents.current.average) + " · " + plural(incidents.current.highCount, "corrida", "corridas") + " com 4 pontos ou mais",
      body: (
        <div className="ngd-ev-grid">
          <Stat label="Agora" value={incidents.current.average === null ? "—" : dec(incidents.current.average)} />
          <Stat label="Referência" value={incidents.reference.average === null ? "—" : dec(incidents.reference.average)} />
          <Stat label="Corridas com 4+ pontos" value={String(incidents.current.highCount)} tone="caution" />
        </div>
      ),
    },
    {
      title: "Abandonos",
      summary: retirements.currentCount ? plural(retirements.currentCount, "corrida", "corridas") + (confirmed ? " · " + confirmed + " confirmado" + (confirmed === 1 ? "" : "s") : " · todos prováveis") : "nenhum",
      body: (
        <div className="ngd-ev-list">
          <div className="ngd-ev-line">Agora: {retirements.currentCount} ({retirements.currentRate ?? 0}% das corridas) · {referenceLabel}: {retirements.referenceCount} ({retirements.referenceRate ?? 0}%)</div>
          {retirements.items.map((item) => (
            <div className="ngd-ev-item" key={item.date + item.track}>
              <span><strong>{shortDate(item.date)} · {item.track}</strong> · {item.type} · {plural(item.completedLaps, "volta", "voltas")}</span>
              <span data-tone={toneOf(item.delta)}>{signedInt(item.delta)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Consistência dos pedais",
      summary: pedalText(pedals.current) ?? "sem telemetria suficiente",
      body: (
        <div className="ngd-ev-list">
          <div className="ngd-ev-grid">
            <Stat label="Agora" value={pedalText(pedals.current) ?? "—"} small />
            <Stat label={referenceLabel} value={pedalText(pedals.reference) ?? "—"} small />
            <Stat label="Voltas analisadas" value={pedals.laps + " · ref. " + pedals.referenceLaps} small />
          </div>
          {pedals.note && <div className="ngd-ev-line">{pedals.note}</div>}
        </div>
      ),
    },
    {
      title: "Sequências de resultado",
      summary: "ganhando " + streaks.gain + " · perdendo " + streaks.loss + " · recorde " + streaks.recordGain,
      body: (
        <div className="ngd-ev-grid">
          <Stat label="Maior sequência ganhando" value={streaks.gain + " (ref. " + streaks.referenceGain + ")"} tone="gain" />
          <Stat label="Maior sequência de derrotas" value={streaks.loss + " (ref. " + streaks.referenceLoss + ")"} tone="loss" />
          <Stat label="Recorde ganhando" value={String(streaks.recordGain)} />
        </div>
      ),
    },
    {
      title: "Como calculamos",
      summary: "perda grande = mais de " + section.kpis.severeThreshold + " pontos numa corrida",
      body: <ul className="ngd-ev-method">{method.map((line) => <li key={line}>{line}</li>)}</ul>,
    },
  ];
  return (
    <Panel kicker="EVIDÊNCIA" title="Números de apoio" subtitle="Abra só o que quiser conferir: o resumo lá em cima já traz as conclusões">
      {items.map((item, index) => {
        const isOpen = open.has(index);
        return (
          <div key={item.title}>
            <button type="button" className="ngd-ev-head" aria-expanded={isOpen} onClick={() => toggle(index)}>
              <span className="ngd-ev-title">{item.title}</span>
              <span className="ngd-ev-summary">{item.summary} <span className="ngd-ev-toggle">{isOpen ? "Fechar ▴" : "Abrir ▾"}</span></span>
            </button>
            {isOpen && <div className="ngd-ev-body">{item.body}</div>}
          </div>
        );
      })}
    </Panel>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: "gain" | "loss" | "caution"; small?: boolean }) {
  return (
    <div>
      <div className="ngd-stat-label">{label}</div>
      <div className="ngd-stat-value" data-tone={tone} data-small={small ? "" : undefined}>{value}</div>
    </div>
  );
}
