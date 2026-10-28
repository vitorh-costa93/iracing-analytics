"use client";

import { signedNumber } from "@/components/overview/format";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Chip, Panel, PageTitle, SegmentedControl } from "@/components/ui";
import type { ChipTone } from "@/components/ui";
import type { DebriefContextRow, DebriefRaceRow, DebriefReport, DebriefSection, PedalSet, RetirementItem, SeasonCompareRow } from "@/lib/debrief-types";
import { dec, plural, signedDec, signedInt } from "@/lib/debrief-narrative";
import { weekLabel } from "@/lib/season-week";
import { DivergingRow, LossTimingBars, PaceScatter, WeekPressureBars } from "./DebriefCharts";
import { CarsTable, Cascade, CausesTable, GridScatter, fieldTone } from "./DebriefField";

type Scope = "week" | "season";
type Segment = "formula" | "gt3" | "imsa";

// Versão do cache local: v9 (13/10/2026: bloco `field` do campo completo, comparação até o mesmo ponto); v8 (contextos da week com mínimo de 1 corrida; v7: contextos por média, evidência completa; contrato em lib/debrief-types.ts). Suba ao mudar a
// forma do payload, para nenhum navegador carregar um payload antigo direto no estado (bug de 08/09).
const CACHE_VERSION = "iracing-debrief-v10-";
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
    const load = (attempt: number): Promise<DebriefReport> => fetch("/api/dashboard/report?scope=" + scope + "&segment=" + segment, { cache: retry || attempt ? "no-store" : "default" })
      .then(async (response) => {
        const raw = await response.text();
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw new Error("O servidor não conseguiu concluir a análise desta vez."); }
        if (!response.ok) throw Object.assign(new Error(data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "Não foi possível montar o debrief."), { retryable: response.status >= 500 });
        return data as DebriefReport;
      })
      // Falha transitória (Supabase/Vercel a frio): uma nova tentativa automática antes de mostrar erro.
      .catch((reason) => (attempt < 1 && !dead && (reason instanceof TypeError || (reason as { retryable?: boolean })?.retryable) ? load(attempt + 1) : Promise.reject(reason)));
    load(0)
      .then((data) => {
        if (dead) return;
        setReport(data);
        setSlow(false);
        try { window.localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* sem espaço: segue sem cache */ }
      })
      .catch((reason) => {
        if (dead) return;
        const detail = reason instanceof Error && reason.message ? " (" + reason.message + ")" : "";
        setError((hadCache ? "A atualização falhou; mostrando a última análise salva." : "A análise não foi concluída.") + detail);
        setSlow(false);
      })
      .finally(() => window.clearTimeout(slowTimer));
    return () => { dead = true; window.clearTimeout(slowTimer); };
  }, [scope, segment, retry]);

  const section = report?.sections.find((item) => item.segment === segment) ?? null;
  const eyebrow = scope === "season"
    ? "Race Engineer · " + (report ? report.seasonName + " vs. " + (section?.field ? section.field.referenceLabel : report.previousSeasonName) : "season atual vs. anterior")
    : "Race Engineer · " + (section?.week ? weekLabel(section.week) : "semana atual") + " vs. demais semanas";

  return (
    <div className="ng-page">
      <main className="ng-main ngd-main">
        <PageTitle
          eyebrow={eyebrow}
          title={scope === "season" ? "Debrief da season" : "Debrief da semana"}
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
        {section && <Debrief section={section} scope={scope} referenceLabel={scope === "season" ? (section.field?.referenceLabel ?? report!.previousSeasonName) : "demais semanas"} />}
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
  const refLegend = scope === "season" ? "season anterior" : "demais semanas";
  const impactMax = Math.max(1, ...section.impactRaces.map((race) => Math.abs(race.delta)));
  const raceMax = Math.max(1, ...section.raceList.map((race) => Math.abs(race.delta)));
  const contextRows = [...section.contexts.losses, ...section.contexts.gains];
  const contextAvg = (row: { avgDelta: number }) => row.avgDelta;
  const contextMax = Math.max(1, ...contextRows.map((row) => Math.abs(contextAvg(row))));
  const incidentTone = kpis.incidentsAvg === null || kpis.incidentsRef === null ? "neutral" : kpis.incidentsAvg <= kpis.incidentsRef ? "gain" : kpis.incidentsAvg - kpis.incidentsRef >= 0.5 ? "loss" : "neutral";
  const streak = kpis.streak;
  const field = section.field && section.field.now.races ? section.field : null;
  return (
    <>
      <section className="ng-panel ngd-quick" aria-label="Leitura rápida">
        <div className="ngd-quick-head">
          <div className="ngd-quick-kicker">LEITURA RÁPIDA</div>
          <Chip tone={confidence.tone}>amostra: {plural(section.races, "corrida", "corridas")} · {confidence.label}</Chip>
        </div>
        <p className="ngd-quick-summary">{narrative.summary}</p>
        {narrative.referenceLine && <p className="ngd-quick-pace">{narrative.referenceLine}</p>}
        <p className="ngd-quick-pace"><strong>Ritmo e resultado:</strong> {narrative.paceVsResult}</p>
        <div className="ngd-quick-action"><span>O QUE FAZER</span><p>{narrative.action}</p></div>
      </section>

      <section className={"ngd-kpis" + (field ? " ngd-kpis-8" : "")} aria-label="Indicadores">
        <Kpi label="Saldo de iRating" value={signedInt(kpis.net)} tone={toneOf(kpis.net)}
          sub={kpis.referenceNet === null ? "sem referência" : scope === "season" ? "vs. " + referenceLabel + ": " + signedInt(kpis.referenceNet) : "média das outras: " + signedInt(kpis.referenceNet) + "/corrida"} />
        {field && field.now.permanencePct !== null && (
          <Kpi label="Permanência" value={field.now.permanencePct + "%"} tone={field.now.permanencePct >= 80 ? "gain" : "loss"}
            sub={field.now.kept + " de " + (field.now.kept + field.now.early) + " com 90% das voltas ou mais" + (field.before.permanencePct !== null ? " · antes: " + field.before.permanencePct + "%" : "")} />
        )}
        {field && field.now.residualAvg !== null && (
          <Kpi label="Resultado vs esperado" value={signedDec(field.now.residualAvg, 1)} tone={fieldTone(field.now.residualAvg)}
            sub={"iR por corrida contra o que seu iRating previa" + (field.before.residualAvg !== null ? " · antes: " + signedDec(field.before.residualAvg, 1) : "")} />
        )}
        {field && field.now.paceTopPct !== null && (
          <Kpi label="Ritmo vs grid" value={"top " + field.now.paceTopPct + "%"} tone="neutral"
            sub={"melhor volta na classe" + (field.before.paceTopPct !== null ? " · antes: top " + field.before.paceTopPct + "%" : "")} />
        )}
        <Kpi label="Perdas grandes" value={String(kpis.severeCount)} tone={kpis.severeCount ? "loss" : "gain"} sub={"mais de " + kpis.severeThreshold + " pontos numa corrida" + (field && field.before.races ? " · antes: " + referenceSevere(section) : "")} />
        {field ? (
          <Kpi label="Pódios" value={String(field.now.podiums)} tone="neutral" sub={"vitórias: " + field.now.wins + (field.before.races ? " · antes: " + field.before.podiums + " (" + field.before.wins + (field.before.wins === 1 ? " vitória)" : " vitórias)") : "")} />
        ) : (
          <Kpi label="Abandonos" value={String(kpis.retirements)} tone="neutral" sub={kpis.retirements ? (kpis.retirementRate ?? 0) + "% das corridas" : scope === "week" ? "nenhum na semana" : "nenhum na season"} />
        )}
        <Kpi label="Incidentes" value={kpis.incidentsAvg === null ? "—" : dec(kpis.incidentsAvg)} unit={kpis.incidentsAvg === null ? undefined : "/ corrida"} tone={incidentTone} sub={kpis.incidentsRef === null ? "sem referência" : "referência: " + dec(kpis.incidentsRef)} />
        <Kpi label="Sequência" value={streak.direction ? streak.length + (streak.direction === "gain" ? " ↑" : " ↓") : "0"} tone={streak.direction === "gain" ? "gain" : streak.direction === "loss" ? "loss" : "neutral"}
          sub={(streak.direction === "gain" ? "ganhando iRating" : streak.direction === "loss" ? "perdendo iRating" : "sem sequência aberta") + " · recorde " + streak.recordGain} />
      </section>

      {field && <LeftOnTablePanel lot={field.leftOnTable} />}

      {field ? (
        <div className="ngd-row-2">
          <Panel kicker="RITMO CONTRA O GRID × RESULTADO" title="Seu ritmo no grid virou iRating?"
            subtitle={"Cada ponto é uma corrida: onde sua melhor volta ficou no grid da classe, contra o iRating ganho. Cinza: " + field.referenceLabel}>
            {field.scatter.now.length ? <GridScatter now={field.scatter.now} before={field.scatter.before} label={field.referenceLabel} /> : <div className="ngd-empty">Sem melhor volta do campo para montar o gráfico.</div>}
          </Panel>
          <Panel kicker={scope === "week" ? "CASCATA DA SEMANA" : "CASCATA DA SEASON"} title={"De onde vêm os " + signedInt(field.now.net) + " iR"}
            subtitle={"Δ iR por desfecho. Saída antecipada = menos de 90% das voltas da classe. Contagens: agora · " + field.referenceLabel}>
            <Cascade now={field.now} before={field.before} referenceName={field.referenceLabel} />
          </Panel>
        </div>
      ) : null}
      {field ? (
        <div className="ngd-row-2 ngd-row-even">
          <Panel kicker="CAUSAS DA SAÍDA" title="Por que as corridas acabam cedo" subtitle="Classificação pela assinatura das voltas de corrida. Corridas · iR perdido"
            actions={<Chip tone="formula">regra automática · evidência média</Chip>}>
            <CausesTable field={field} referenceName={field.referenceLabel} />
            <p className="ngd-note">Não há tipo de incidente (contato, off track, perda de controle) nas voltas; só dá para inferir pela assinatura.</p>
          </Panel>
          <Panel kicker={section.label.toUpperCase() + " POR CARRO"} title={"Cada carro, agora contra " + (scope === "week" ? "a mesma semana da anterior" : "o mesmo ponto da anterior")} subtitle="Corridas · Δ iR · saída · ritmo no grid · resultado vs esperado. Cinza: menos de 5 corridas">
            <CarsTable field={field} referenceName={field.referenceLabel} segmentLabel={section.label} />
          </Panel>
        </div>
      ) : null}
      {!field && <div className="ngd-row-2">
        <Panel kicker="NOVO · RITMO × RESULTADO" title="Você foi perto do seu melhor, mas perdeu iRating?" className="ngd-h340"
          subtitle={(scope === "season" ? "Cada ponto é uma semana" : "Cada ponto é uma corrida") + ": quão longe sua melhor volta ficou da sua melhor volta no mesmo carro e pista, contra o iRating ganho"}>
          {section.pace.points.length ? <PaceScatter pace={section.pace} /> : <div className="ngd-empty">Sem volta de corrida registrada para montar o gráfico.</div>}
        </Panel>
        <Panel kicker="NOVO · QUANDO AS PERDAS ACONTECEM" title="Em que ponto da corrida você perde" className="ngd-h340"
          subtitle="Quanto da corrida já tinha passado quando a perda grande aconteceu"
          actions={<div className="ngd-legend"><span data-kind="now">■ agora</span><span data-kind="ref">■ {refLegend}</span></div>}>
          <LossTimingBars current={section.lossTiming.current} reference={section.lossTiming.reference} referenceLabel={refLegend} />
          <p className="ngd-note">{narrative.lossTiming.before}{narrative.lossTiming.strong && <strong>{narrative.lossTiming.strong}</strong>}{narrative.lossTiming.after}</p>
        </Panel>
      </div>}

      <div className="ngd-row-2 ngd-row-even">
        {scope === "season" ? (
          <Panel kicker="PRESSÃO POR SEMANA" title="Como cada semana fechou o iRating" subtitle={narrative.trendSubtitle} className="ngd-h270">
            <WeekPressureBars weeks={section.weeks} />
          </Panel>
        ) : (
          <Panel kicker="CORRIDAS DA SEMANA" title="O que cada corrida rendeu" subtitle={narrative.trendSubtitle} className="ngd-h270">
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
        <Panel kicker="CONTEXTOS" title="Onde você perde e onde você sustenta ganhos" subtitle={scope === "week" ? "Média por corrida, cada combinação de carro e pista da semana" : "Média por corrida, só combinações de carro e pista com 2 corridas ou mais"}>
          {contextRows.length ? contextRows.map((row) => (
            <DivergingRow key={row.track + row.car} title={row.track} subtitle={contextSubtitle(row)} value={contextAvg(row)} max={contextMax} valueText={signedNumber(contextAvg(row), 1) + "/corrida"} />
          )) : <div className="ngd-empty">{scope === "week" ? "Nenhuma corrida nesta semana ainda." : "Nenhuma combinação de carro e pista com 2 corridas ou mais nesta season."}</div>}
        </Panel>
        <Evidence section={section} referenceLabel={scope === "season" ? "Season anterior" : "Demais semanas"} />
      </div>
    </>
  );
}

function referenceSevere(section: DebriefSection) {
  return String(section.evidence.severity.referenceCount);
}

function contextSubtitle(row: DebriefContextRow) {
  const parts = [row.car, plural(row.races, "corrida", "corridas"), "saldo total " + signedInt(row.delta)];
  if (row.avgPositionChange !== null) {
    const places = Math.abs(row.avgPositionChange);
    parts.push(places < 0.05 ? "mesma posição em média" : (row.avgPositionChange > 0 ? "ganha " : "perde ") + dec(places, 1) + (places > 1 ? " posições" : " posição") + " por corrida");
  }
  if (row.shareOfLosses !== null) parts.push(row.shareOfLosses + "% de tudo o que você perdeu");
  return parts.join(" · ");
}

function impactSubtitle(race: DebriefRaceRow) {
  return "P" + (race.grid ?? "—") + " → P" + race.finish + (race.sof ? " · SoF " + race.sof : "") + (race.lossShare ? " · " + race.lossShare + "% das perdas" : "");
}

function Kpi({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub: string; tone: "gain" | "loss" | "neutral" }) {
  return (
    <div className="ngd-kpi">
      <div className="ngd-kpi-label">{label}</div>
      <div className="ngd-kpi-value" data-tone={tone}>{value}{unit && <span className="ngd-kpi-unit">{unit}</span>}</div>
      <div className="ngd-kpi-sub">{sub}</div>
    </div>
  );
}

const LEFT_REASON = { bigLoss: "perda grande", earlyExit: "saída antecipada", both: "perda grande e saída antecipada" } as const;

function LeftOnTablePanel({ lot }: { lot: NonNullable<DebriefSection["field"]>["leftOnTable"] }) {
  const none = lot.eligible === 0 || (lot.included > 0 && lot.total === 0);
  return (
    <section className="ngd-kpis" aria-label="iRating deixado na mesa" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <Kpi label="iRating deixado na mesa" value={none ? "Nada deixado na mesa" : lot.included ? "+" + lot.total : "—"} tone={none ? "gain" : lot.total ? "loss" : "neutral"}
        sub={lot.eligible === 0
          ? "nenhuma corrida com perda grande ou saída antecipada"
          : "em " + plural(lot.included, "corrida", "corridas") + " com perda grande ou saída antecipada" + (lot.withoutExpected ? " · " + plural(lot.withoutExpected, "corrida", "corridas") + " sem esperado calculável" : "") + (lot.withoutLeft !== null && lot.total > 0 ? " · seria " + lot.withoutLeft + " hoje (agora " + lot.currentIrating + ")" : "")} />
      {lot.top.length > 0 && (
        <details className="ngd-note">
          <summary>Corridas que mais custaram</summary>
          {lot.top.map((race) => (
            <p key={race.date + race.track}>
              {shortDate(race.date)} · {race.car} · {race.track}: esperado {signedInt(race.expected)}, real {signedInt(race.real)}, deixou +{race.left} ({LEFT_REASON[race.reason]})
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

const CONFIDENCE_CHIP: Record<RetirementItem["confidence"], { label: string; tone: ChipTone }> = {
  driver: { label: "confirmado por você", tone: "gain" },
  confirmed: { label: "tow confirmado", tone: "gain" },
  probable: { label: "provável", tone: "neutral" },
};

function formatDuration(seconds: number) {
  const total = Math.round(seconds), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  return hours ? hours + " h " + String(minutes).padStart(2, "0") + " min" : minutes + " min";
}

const UNIT_TEXT: Record<SeasonCompareRow["unit"], string> = { "%": "%", pts: " pontos", pos: " posições", s: " s" };
const compareDigits = (row: SeasonCompareRow) => (row.unit === "s" ? 2 : 1);
function compareValue(row: SeasonCompareRow, value: number | null) {
  return value === null ? "—" : dec(value, compareDigits(row)) + UNIT_TEXT[row.unit];
}
function compareChange(row: SeasonCompareRow) {
  const change = row.change as number;
  // Segundos: negativo = mais perto/mais constante (bom). Nas demais métricas, positivo = melhor.
  const words = row.direction === "stable" ? "estável" : row.direction === "improved" ? "melhorou" : "piorou";
  return words + " (" + signedNumber(change, compareDigits(row)) + (row.unit === "%" ? " pontos percentuais" : UNIT_TEXT[row.unit]) + ")";
}

const pedalText =(set: PedalSet) => {
  const parts = [["freio", set.brake], ["acelerador", set.throttle], ["volante", set.steering]].filter((item): item is [string, number] => item[1] !== null);
  return parts.length ? parts.map(([name, value]) => name + " " + value + "%").join(" · ") : null;
};

function Evidence({ section, referenceLabel }: { section: DebriefSection; referenceLabel: string }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => { setOpen(new Set([0])); }, [section.segment, section.week]);
  const { severity, seasonComparison, incidents, retirements, pedals, streaks, method } = section.evidence;
  const pct = (value: number | null) => (value === null ? "—" : dec(value, 1) + "%");
  const toggle = (index: number) => setOpen((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const confirmed = retirements.items.filter((item) => item.confidence !== "probable").length;
  const runText = (length: number, total: number | null) => (length ? plural(length, "perda seguida", "perdas seguidas") + (total !== null ? " (" + signedInt(total) + ")" : "") : "nenhuma");
  const items: Array<{ title: string; summary: string; body: ReactNode }> = [
    {
      title: "Perdas grandes",
      summary: severity.count ? plural(severity.count, "corrida", "corridas") + " · " + pct(severity.rate) + " das corridas" : "nenhuma acima de " + severity.threshold + " pontos",
      body: (
        <div className="ngd-ev-grid">
          <Stat label="Agora" value={severity.count + " (" + pct(severity.rate) + ")"} tone={severity.count ? "loss" : "gain"} />
          <Stat label={referenceLabel} value={severity.referenceCount + " (" + pct(severity.referenceRate) + ")"} />
          <Stat label="Perdido nelas" value={severity.lossTotal === null ? "—" : signedInt(-Math.abs(severity.lossTotal)) + " · " + pct(severity.shareOfLosses) + " das perdas"} small />
          <Stat label={"Perdido nelas · " + referenceLabel.toLowerCase()} value={severity.referenceLossTotal === null ? "—" : signedInt(-Math.abs(severity.referenceLossTotal)) + " · " + pct(severity.referenceShareOfLosses) + " das perdas"} small />
          <Stat label="Pior sequência agora" value={runText(severity.worstRunLength, severity.worstRunLength ? severity.worstRunDelta : null)} small />
          <Stat label={"Pior sequência · " + referenceLabel.toLowerCase()} value={runText(severity.referenceWorstRunLength, severity.referenceWorstRunLength ? severity.referenceWorstRunDelta : null)} small />
        </div>
      ),
    },
    ...(seasonComparison ? [{
      title: "Season atual contra a anterior",
      summary: seasonComparison.improved.length + " melhoraram · " + seasonComparison.worsened.length + " pioraram · " + seasonComparison.stable.length + " estáveis",
      body: (
        <div className="ngd-ev-list">
          {([["Melhorou", "gain", seasonComparison.improved], ["Piorou", "loss", seasonComparison.worsened], ["Estável", "neutral", seasonComparison.stable]] as const).map(([label, tone, rows]) => rows.length > 0 && (
            <div className="ngd-ev-list" key={label}>
              <div className="ngd-stat-label">{label}</div>
              {rows.map((row) => (
                <div className="ngd-ev-item" key={row.metric}>
                  <span>{row.metric}: {compareValue(row, row.now)} agora, {compareValue(row, row.before)} antes</span>
                  <span data-tone={tone}>{row.change === null ? "—" : compareChange(row)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ),
    }] : []),
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
              <span><strong>{shortDate(item.date)} · {item.track}</strong> · {item.type} · {plural(item.completedLaps, "volta", "voltas")}{item.timeOnTrackSeconds > 0 && " · " + formatDuration(item.timeOnTrackSeconds) + " em pista"}{item.progressPct !== null && " · " + Math.round(item.progressPct) + "% da corrida"} <Chip tone={CONFIDENCE_CHIP[item.confidence].tone}>{CONFIDENCE_CHIP[item.confidence].label}</Chip></span>
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
            <Stat label="Distância até a sua melhor volta" value={pedals.gapSeconds === null ? "—" : dec(pedals.gapSeconds, 2) + " s (ref. " + (pedals.referenceGapSeconds === null ? "—" : dec(pedals.referenceGapSeconds, 2) + " s") + ")"} small />
            <Stat label="Variação entre voltas" value={pedals.stdSeconds === null ? "—" : dec(pedals.stdSeconds, 2) + " s (ref. " + (pedals.referenceStdSeconds === null ? "—" : dec(pedals.referenceStdSeconds, 2) + " s") + ")"} small />
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
