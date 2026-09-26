"use client";

import { useEffect, useState } from "react";
import { Chip, Panel, SelectPill } from "@/components/ui";
import { formatLapTime } from "@/lib/telemetry-trace";
import { formatVariation, type SelfSectionTalk } from "@/lib/debrief-talk";
import { trackUiEvent } from "@/lib/track-ui-event";
import type { Variation } from "@/lib/self-consistency";

/**
 * Race Debrief no Night Grid (redesign etapa 4, 26/09/2026; mockup docs/redesign-mockup/Debrief.dc.html).
 * Dados de /api/telemetry/race-debrief (Supabase-first, cache por corrida). A seção "Curva a curva ×
 * Consistência" compara o piloto com ele mesmo nas voltas da corrida, por trecho (curvas coladas
 * formam uma sequência). CSS em app/night-grid-debrief.css (prefixo .ngr-).
 */
type RaceOption = { id: string; label: string; category: string | null; hasSession: boolean; telemetryLaps: number };
type SectionPayload = {
  id: string; label: string; isSequence: boolean; laps: number;
  variation: { brake: Variation; throttle: Variation; steering: Variation };
  talk: SelfSectionTalk;
};
type Debrief = {
  race: {
    id: string; label: string; car: string | null; track: string | null; carId: number | null; trackId: number | null; category: string | null;
    grid: number | null; finish: number | null; incidents: number | null; laps: number | null;
    iratingDelta: number | null; iratingBefore: number | null; iratingAfter: number | null;
  };
  pace: { bestLap: number | null; cleanAverage: number | null; cleanLaps: number; reference: { kind: "reference" | "winner"; gap: number } | null };
  micro: { perMinute: number; perLap: number; laps: number; reference: number | null } | null;
  sample: { telemetryLaps: number; lapsWithoutTelemetry: number; robust: boolean };
  strengths: string[]; improvements: string[]; right: string[]; wrong: string[];
  selfNote: string | null;
  sections: SectionPayload[];
  sectors: { lapsAnalyzed: number; idealLap: number; bestLap: number; gap: number; worstSector: number; rows: { sector: number; best: number; stddev: number; mean: number }[] } | null;
  sectorsMessage: string | null;
  discarded: { lapNumber: number | null; lapTime: number; reason: string }[];
};

const CATEGORY_LABEL: Record<string, string> = { sports_car: "Sports Car", formula_car: "Formula Car", road: "Road" };
const FULL_SCALE = { brake: 7, throttle: 0.35, steering: 15 } as const;

function decimal(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}
function signed(value: number, digits: number, unit = " s") {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${decimal(Math.abs(rounded), digits)}${unit}`;
}
function thousands(value: number) {
  return value.toLocaleString("pt-BR");
}
/** "1:36.02": ritmo médio com duas casas, como no mockup. */
function shortLap(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}
function barWidth(gapSeconds: number, best: number) {
  return Math.max(12, Math.min(100, 100 - (Math.abs(gapSeconds) / best) * 100 * 45));
}

function Bullets({ items, tone }: { items: string[]; tone: "gain" | "loss" }) {
  return (
    <div className="ngr-bullets">
      {items.map((text) => <div key={text} className="ngr-bullet"><span data-tone={tone} aria-hidden /><span>{text}</span></div>)}
    </div>
  );
}

function VariationBar({ label, kind, item }: { label: string; kind: "brake" | "throttle" | "steering"; item: Variation }) {
  return (
    <div className="ngr-var">
      <span>{label}</span>
      <div className="ngr-track"><div className="ngr-fill" data-tone={item?.tone} style={{ width: item ? `${Math.max(4, Math.min(95, (item.value / FULL_SCALE[kind]) * 100))}%` : "0%" }} /></div>
      <span className="ngr-var-value">{item ? formatVariation(kind, item.value) : kind === "brake" ? "sem freio" : "—"}</span>
    </div>
  );
}

export default function RaceDebriefView({ onOpenReference }: { onOpenReference?: () => void }) {
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/telemetry/race-debrief${raceId ? `?raceId=${encodeURIComponent(raceId)}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || result.status !== "ok") throw new Error(result.message ?? "Erro ao montar o debrief");
        if (!active) return;
        setRaces(result.races ?? []);
        setDebrief(result.debrief ?? null);
        setMessage(result.message ?? null);
        if (!raceId && result.selectedId) setRaceId(result.selectedId);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // raceId muda também quando o servidor escolhe a corrida padrão; o fetch repetido cai no cache.
  }, [raceId, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !debrief) return <div className="ngt-state">Montando o debrief da corrida: resultado, voltas e telemetria armazenada…</div>;
  if (error && !debrief) return <div className="ngt-state" data-tone="error">{error}<button type="button" className="ngt-link-button" onClick={() => setRetry((count) => count + 1)}>Tentar novamente</button></div>;
  if (!debrief) return <div className="ngt-state">{message ?? "Nenhuma corrida encontrada."}</div>;

  const { race, pace, micro, sample } = debrief;
  const gained = race.grid !== null && race.finish !== null ? race.grid - race.finish : null;
  const resultTone = gained === null || gained === 0 ? undefined : gained > 0 ? "gain" : "loss";
  const iratingTone = race.iratingDelta === null || race.iratingDelta === 0 ? undefined : race.iratingDelta > 0 ? "gain" : "loss";
  const perLapIncidents = race.incidents !== null && race.laps ? race.incidents / race.laps : null;
  const microTone = !micro || micro.reference === null ? undefined : micro.perMinute <= micro.reference ? "gain" : micro.perMinute <= micro.reference * 1.15 ? "caution" : "loss";
  const bestLap = pace.bestLap;
  const avgGap = bestLap !== null && pace.cleanAverage !== null ? pace.cleanAverage - bestLap : null;
  const sampleText = sample.telemetryLaps
    ? `${sample.robust ? "amostra robusta" : "amostra limitada"} · ${sample.telemetryLaps} ${sample.telemetryLaps === 1 ? "volta analisada" : "voltas analisadas"}`
    : "sem telemetria armazenada";
  const options = races.map((item) => ({ value: item.id, label: `${item.label}${item.telemetryLaps >= 3 ? "" : !item.hasSession ? " · sem sessão Garage61" : " · sem telemetria"}` }));

  return (
    <div className="ngr-screen" aria-busy={loading}>
      <div className="ngr-toolbar">
        <SelectPill ariaLabel="Corrida" value={raceId ?? race.id} options={options} className="ngr-race-select"
          onChange={(value) => { setRaceId(value); const item = races.find((entry) => entry.id === value); trackUiEvent("debrief_category_selected", { category: item?.category ?? undefined }); }} />
        <Chip tone={sample.robust ? "gain" : "neutral"}>{sampleText}</Chip>
        {loading && <span className="ngr-loading">atualizando…</span>}
        <div className="ngr-spacer" />
        <div className="ngr-hint">O ritmo aqui é medido pela sua melhor volta da corrida</div>
      </div>

      <div className="ngr-kpis">
        <div className="ngr-kpi">
          <div className="ngr-kpi-label">Resultado</div>
          <div className="ngr-kpi-value" data-tone={resultTone}>{race.finish !== null ? `P${race.finish}` : "—"}</div>
          <div className="ngr-kpi-sub">{race.grid !== null ? `largou em P${race.grid}` : "largada sem registro"}{gained !== null ? ` · ${gained === 0 ? "mesma posição" : `${gained > 0 ? "+" : "−"}${Math.abs(gained)} ${Math.abs(gained) === 1 ? "posição" : "posições"}`}` : ""}</div>
        </div>
        <div className="ngr-kpi">
          <div className="ngr-kpi-label">Δ iRating</div>
          <div className="ngr-kpi-value" data-tone={iratingTone}>{race.iratingDelta === null ? "—" : `${race.iratingDelta > 0 ? "+" : race.iratingDelta < 0 ? "−" : ""}${Math.abs(race.iratingDelta)}`}</div>
          <div className="ngr-kpi-sub">{CATEGORY_LABEL[race.category ?? ""] ?? "Categoria"}{race.iratingBefore !== null && race.iratingAfter !== null ? ` · ${thousands(race.iratingBefore)} → ${thousands(race.iratingAfter)}` : ""}</div>
        </div>
        <div className="ngr-kpi">
          <div className="ngr-kpi-label">Melhor volta</div>
          <div className="ngr-kpi-value">{bestLap !== null ? formatLapTime(bestLap) : "—"}</div>
          <div className="ngr-kpi-sub">{pace.cleanAverage !== null && avgGap !== null ? `ritmo médio ${shortLap(pace.cleanAverage)} · ${signed(avgGap, 2)}` : "sem voltas limpas suficientes"}</div>
        </div>
        <div className="ngr-kpi">
          <div className="ngr-kpi-label">Incidentes</div>
          <div className="ngr-kpi-value" data-tone={race.incidents === null ? undefined : race.incidents === 0 ? "gain" : "caution"}>{race.incidents !== null ? `${race.incidents} x` : "—"}</div>
          <div className="ngr-kpi-sub">{perLapIncidents !== null ? `${decimal(perLapIncidents, 3)}/volta · ${race.laps} voltas` : "sem registro"}</div>
        </div>
        <div className="ngr-kpi">
          <div className="ngr-kpi-label">Microcorreções</div>
          <div className="ngr-kpi-value" data-tone={microTone}>{micro ? `${Math.round(micro.perMinute)}/min` : "—"}</div>
          <div className="ngr-kpi-sub">{!micro ? "precisa de telemetria da corrida" : micro.reference !== null ? `referência da classe: ${Math.round(micro.reference)}/min` : `${decimal(micro.perLap, 0)} por volta · sem referência`}</div>
        </div>
      </div>

      <div className="ngr-two">
        <Panel kicker="Pontos fortes" title="O que manter"><Bullets items={debrief.strengths} tone="gain" /></Panel>
        <Panel kicker="Pontos de melhoria" title="Onde focar no treino"><Bullets items={debrief.improvements} tone="loss" /></Panel>
      </div>

      <div className="ngr-pace-row">
        <Panel kicker="Ritmo" title="Quanto você está da sua melhor volta" subtitle="Uma volta de referência, sem volta a volta: o que importa é a distância até ela">
          {bestLap === null ? <div className="ngr-empty">Sem tempo de volta registrado nesta corrida.</div> : (
            <div className="ngr-pace">
              <div className="ngr-pace-item">
                <div className="ngr-pace-head"><span>Sua melhor volta da corrida</span><span>{formatLapTime(bestLap)}</span></div>
                <div className="ngr-track ngr-track-lg"><div className="ngr-fill" data-tone="ok" style={{ width: "100%" }} /></div>
                <div className="ngr-note">É a régua de tudo neste debrief</div>
              </div>
              {avgGap !== null && (
                <div className="ngr-pace-item">
                  <div className="ngr-pace-head"><span>Média das voltas limpas</span><span>{signed(avgGap, 2)}</span></div>
                  <div className="ngr-track ngr-track-lg"><div className="ngr-fill" data-tone="warn" style={{ width: `${barWidth(avgGap, bestLap)}%` }} /></div>
                  <div className="ngr-note">Sem incidentes, sem retardatários · {pace.cleanLaps} voltas</div>
                </div>
              )}
              {pace.reference && (
                <div className="ngr-pace-item">
                  <div className="ngr-pace-head"><span>{pace.reference.kind === "reference" ? "Referência da classe" : "Vencedor da classe"}</span><span>{signed(pace.reference.gap, 3)}</span></div>
                  <div className="ngr-track ngr-track-lg"><div className="ngr-fill" data-tone="reference" style={{ width: `${barWidth(pace.reference.gap, bestLap)}%` }} /></div>
                  <div className="ngr-note">{pace.reference.kind === "reference" ? "Melhor volta de referência do mesmo carro e pista" : "Melhor volta de quem venceu a sua classe (iRStats)"}</div>
                </div>
              )}
            </div>
          )}
        </Panel>
        <Panel kicker="Setores" title="Sua volta ideal, setor a setor" subtitle="Juntando o melhor de cada setor nas voltas mais rápidas">
          {!debrief.sectors ? <div className="ngr-empty">{debrief.sectorsMessage}</div> : (() => {
            const sectors = debrief.sectors;
            return (
              <div className="ngr-sectors">
                {sectors.rows.map((row) => {
                  const tone = row.stddev <= 0.15 ? "ok" : row.stddev <= 0.3 ? "warn" : "bad";
                  return (
                    <div key={row.sector} className="ngr-sector">
                      <span className="ngr-sector-name">S{row.sector}</span>
                      <div className="ngr-track ngr-track-lg"><div className="ngr-fill" data-tone={tone} style={{ width: `${Math.max(6, Math.min(95, (row.stddev / 0.25) * 100))}%` }} /></div>
                      <span className="ngr-sector-best">{row.best >= 60 ? formatLapTime(row.best) : row.best.toFixed(3)}</span>
                      <span className="ngr-sector-sd" data-tone={tone}>±{decimal(row.stddev, 2)} s</span>
                    </div>
                  );
                })}
                <div className="ngr-sector-foot">
                  Volta ideal <strong>{formatLapTime(sectors.bestLap)} → {formatLapTime(sectors.idealLap)}</strong>: {sectors.gap > 0.0005 ? `dá para tirar ${decimal(sectors.gap, 3)} s sem mudar nada, só repetindo o melhor de cada setor.` : "sua melhor volta já junta o melhor de cada setor."} O S{sectors.worstSector} é onde você mais varia.
                </div>
              </div>
            );
          })()}
        </Panel>
      </div>

      <Panel kicker="Curva a curva × Consistência" title="Você contra você mesmo"
        subtitle="Aqui o comparativo é com as suas outras voltas: quanto seus pedais e volante variam, e o que muda nas voltas rápidas."
        actions={onOpenReference ? <button type="button" className="ngr-link" onClick={onOpenReference}>Ver contra a referência →</button> : undefined}>
        {debrief.selfNote && <div className="ngr-self-note" role="note">{debrief.selfNote}</div>}
        {(debrief.right.length > 0 || debrief.wrong.length > 0) && (
          <div className="ngr-boxes">
            <div className="ngr-box"><div className="ngr-box-title" data-tone="gain">O que você faz certo</div>{debrief.right.length ? <Bullets items={debrief.right} tone="gain" /> : <div className="ngr-note">Nada que se destaque ainda.</div>}</div>
            <div className="ngr-box"><div className="ngr-box-title" data-tone="loss">O que você faz de errado</div>{debrief.wrong.length ? <Bullets items={debrief.wrong} tone="loss" /> : <div className="ngr-note">Nada que se destaque ainda.</div>}</div>
          </div>
        )}
        {debrief.sections.length > 0 && (
          <div className="ngr-table" role="table" aria-label="Consistência por trecho">
            <div className="ngr-table-head" role="row"><span role="columnheader">Trecho</span><span role="columnheader">Quanto varia entre voltas</span><span role="columnheader">O que muda nas suas voltas rápidas</span><span role="columnheader">Se você fizer sempre assim</span></div>
            {debrief.sections.map((section) => (
              <div key={section.id} className="ngr-table-row" role="row">
                <div role="cell"><div className="ngr-row-name">{section.label}</div><div className="ngr-row-kind">{section.isSequence ? "sequência" : "curva única"} · {section.laps} voltas</div></div>
                <div role="cell" className="ngr-vars">
                  <VariationBar label="Freio" kind="brake" item={section.variation.brake} />
                  <VariationBar label="Acelerador" kind="throttle" item={section.variation.throttle} />
                  <VariationBar label="Volante" kind="steering" item={section.variation.steering} />
                </div>
                <div role="cell" className="ngr-fast">{section.talk.fastLaps}</div>
                <div role="cell" className="ngr-if">{section.talk.ifAlways}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel kicker="Voltas descartadas" title="Fora da análise" subtitle="Largada, box, saídas de pista e voltas fora do ritmo: não contam para o ritmo">
        {debrief.discarded.length === 0 ? <div className="ngr-empty">Nenhuma volta descartada nesta corrida.</div> : debrief.discarded.map((lap, index) => (
          <div key={`${lap.lapNumber}-${index}`} className="ngr-discard"><span>Volta {lap.lapNumber ?? "?"} <em>{formatLapTime(lap.lapTime)}</em></span><span>{lap.reason}</span></div>
        ))}
      </Panel>
    </div>
  );
}
