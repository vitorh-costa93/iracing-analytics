"use client";

import { useEffect, useMemo, useState } from "react";
import { Chip, Panel, SelectPill } from "@/components/ui";
import { formatLap, formatSeconds, type GapPoint, type IdealLap, type PlanExercise, type Recommendation } from "@/lib/telemetry-plan";
import { weekLabel } from "@/lib/season-week";

/**
 * Subaba "Plano e volta" do Telemetry Lab (mockup Telemetry.dc.html). Quatro blocos calculados de
 * dados reais por /api/telemetry/plan (lib/telemetry-plan.ts): plano de treino, preparo do
 * calendário, volta ideal e meta de volta. Sem dado suficiente, cada bloco mostra uma linha curta.
 */
type History = { races: number; avgDelta: number | null; recentAvgDelta: number | null; measured: number; exits: number; exitRate: number | null };
type CalendarRow = {
  week: number; kindLabel: string; track: string; current: boolean; practiceLaps: number; setups: number; history: History;
  gap: { pct: number; date: string; old: boolean } | null; recommendation: Recommendation;
};
type IdealContext = {
  key: string; car: string; carClass: string | null; track: string; trackName: string; laps: number; weekLaps: number; cleanLapsFound: number;
  classLeaderLap: number | null; ideal: IdealLap | null;
};
type TargetRow = { kind: string; kindLabel: string; track: string; latest: (GapPoint & { old: boolean }) | null; evolution: GapPoint[] };
type PlanPayload = {
  status: string; message?: string;
  season: null | { id: string; name: string; week: number; source: string | null; importedAt: string | null };
  plan?: { exercises: PlanExercise[]; leak: { car: string; leakIrating: number; races: number; exits: number } | null; fieldRaces: number };
  calendar?: { rows: CalendarRow[] };
  ideal?: { contexts: IdealContext[]; primaryKey: string | null };
  target?: TargetRow[];
};

const pt = (value: number, decimals: number) => value.toFixed(decimals).replace(".", ",");
const signed = (value: number, decimals = 1) => (value > 0 ? "+" : value < 0 ? "−" : "") + pt(Math.abs(value), decimals);
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

function historyText(history: History) {
  if (!history.races) return "—";
  const parts = [signed(history.avgDelta ?? 0) + " · " + history.races + " corr."];
  if (history.exitRate !== null) parts.push(Math.round(history.exitRate * 100) + "% saída");
  return parts.join(" · ");
}

export default function TrainingPlan() {
  const [data, setData] = useState<PlanPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextKey, setContextKey] = useState<string | null>(null);
  const [targetKind, setTargetKind] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/telemetry/plan")
      .then(async (response) => {
        const body = (await response.json()) as PlanPayload;
        if (!response.ok || body.status !== "ok") throw new Error(body.message ?? "Não foi possível montar o plano agora.");
        return body;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Não foi possível montar o plano agora."); });
    return () => { cancelled = true; };
  }, []);

  const contexts = useMemo(() => data?.ideal?.contexts ?? [], [data]);
  const selected = contexts.find((context) => context.key === (contextKey ?? data?.ideal?.primaryKey)) ?? contexts[0] ?? null;
  const targets = useMemo(() => data?.target ?? [], [data]);
  const targetRow = targets.find((row) => row.kind === targetKind) ?? targets.find((row) => row.evolution.length >= 2) ?? targets.find((row) => row.latest) ?? null;

  if (error) return <div className="ngt-screen"><div className="ngt-state" data-tone="error">{error}</div></div>;
  if (!data) return <div className="ngt-screen"><div className="ngt-state">Montando o plano…</div></div>;
  if (!data.season) return <div className="ngt-screen"><div className="ngt-state">Nenhuma season ativa no calendário importado.</div></div>;

  const exercises = data.plan?.exercises ?? [];
  const rows = data.calendar?.rows ?? [];
  const source = data.season.source ? "calendário importado de " + data.season.source + (data.season.importedAt ? " em " + dayMonth(data.season.importedAt) : "") : null;
  const maxGap = Math.max(0, ...targets.map((row) => row.latest?.pct ?? 0));
  const evolution = targetRow?.evolution ?? [];
  const maxEvolution = Math.max(0, ...evolution.map((point) => point.pct));

  return (
    <div className="ngt-screen">
      <div className="ngt-more-contexts"><span>{data.season.name} · {weekLabel(data.season.week)}</span></div>

      <Panel kicker="PLANO DE TREINO" title="Até três exercícios, cada um ligado a um vazamento"
        subtitle="Ordenados pelo que está em jogo: iRating perdido em saídas antecipadas primeiro, depois os setores pela fração do tempo em jogo.">
        {exercises.length ? (
          <div className="ngt-plan-ex">
            {exercises.map((exercise, index) => (
              <div key={exercise.kind}>
                <Chip tone={exercise.kind === "start" ? "loss" : "formula"}>{exercise.chip}</Chip>
                <h3>{index + 1} · {exercise.title}</h3>
                <p>{exercise.text}</p>
                <div className="ng-eyebrow">{exercise.goal}</div>
              </div>
            ))}
          </div>
        ) : <p className="ngt-plan-line">Ainda não há vazamento medido nem voltas limpas suficientes para propor exercícios.</p>}
        {data.plan && <p className="ngt-plan-note">Saída antecipada = menos de 90% das voltas da classe, medido em {data.plan.fieldRaces} corridas com campo importado (só corridas). {data.plan.leak ? "" : "Nenhum carro com iRating perdido em saídas na S4 e na S3 até esta semana."}</p>}
      </Panel>

      <Panel kicker="PREPARO DO CALENDÁRIO" title="Onde já há treino, setup e ritmo, e onde ainda não"
        subtitle="Cruza as semanas restantes da season com as voltas de treino, os setups da biblioteca, o gap para a classe e o histórico de carreira."
        actions={source ? <Chip tone="formula">{source}</Chip> : undefined}>
        {rows.length ? (
          <>
            <div className="ngt-plan-scroll"><table className="ngt-plan-table">
              <thead><tr><th>Sem.</th><th>Contexto</th><th className="r">Voltas de treino</th><th className="r">Setups</th><th className="r">Gap para a classe</th><th className="r">Histórico de carreira</th><th className="r">Recomendação</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.week + row.kindLabel} className={row.current ? "hl" : undefined}>
                    <td>{row.week}</td>
                    <td className="nowrap">{row.kindLabel} · {row.track}</td>
                    <td className={"r" + (row.practiceLaps === 0 ? " ngt-plan-loss" : "")}>{row.practiceLaps}</td>
                    <td className={"r" + (row.setups === 0 ? " ngt-plan-loss" : "")}>{row.setups}</td>
                    <td className="r nowrap">{row.gap ? pt(row.gap.pct, 2) + "%" + (row.gap.old ? " (" + monthYear(row.gap.date) + ")" : "") : <span className="ngt-plan-mu">—</span>}</td>
                    <td className="r nowrap">{historyText(row.history)}</td>
                    <td className="r">
                      <Chip tone={row.recommendation.tone}>{row.recommendation.label}</Chip>
                      {row.recommendation.hints.length > 0 && <span className="sub">{row.recommendation.hints.join(" · ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="ngt-plan-note">Voltas de treino = práticas online desta season, no carro da classe do contexto. Correr = Δ médio ≥ +10 e saídas ≤ 25% · Cautela = Δ ≤ −10 ou saídas ≥ 30% · Preparar = histórico ruim com as 3 últimas corridas em média ≥ +10 · Sem base = menos de 5 corridas · Pista nova = nenhuma corrida. Gap com data = última corrida anterior a esta season. Vermelho = nenhum treino ou setup.</p>
          </>
        ) : <p className="ngt-plan-line">O calendário importado não tem contextos para as semanas restantes.</p>}
      </Panel>

      <div className="ngt-plan-two">
        <Panel kicker={selected ? "VOLTA IDEAL · " + selected.trackName.toUpperCase() : "VOLTA IDEAL"} title="Sua melhor volta contra a soma dos melhores setores"
          subtitle={selected?.ideal ? "Melhor volta " + formatLap(selected.ideal.bestLapTime) + " · ideal " + formatLap(selected.ideal.idealTime) + " · cerca de " + pt(selected.ideal.gap, 2) + " s de diferença. Largura proporcional ao tempo do setor; cor pela perda."
            : "Soma dos melhores setores nas voltas limpas mais rápidas, contra a melhor volta."}
          actions={contexts.length > 1 ? <SelectPill ariaLabel="Contexto da volta ideal" value={selected?.key ?? ""}
            options={contexts.map((context) => ({ value: context.key, label: context.trackName + " · " + context.car }))} onChange={setContextKey} /> : undefined}>
          {!selected ? <p className="ngt-plan-line">Nenhum contexto com voltas nesta season.</p>
            : !selected.ideal ? <p className="ngt-plan-line">{selected.trackName} · {selected.car}: só {selected.cleanLapsFound} {selected.cleanLapsFound === 1 ? "volta limpa" : "voltas limpas"} com setores nesta season (mínimo 5).</p>
            : <IdealView ideal={selected.ideal} carClass={selected.carClass} />}
        </Panel>

        <Panel kicker="META DE VOLTA" title="Distância para a classe em cada contexto"
          subtitle="Sua melhor volta da última corrida no contexto contra a melhor volta da classe na mesma corrida.">
          {targets.some((row) => row.latest) ? (
            <>
              {targets.map((row) => {
                const pct = row.latest?.pct ?? null;
                const selectedRow = row === targetRow;
                return (
                  <div className="ngt-plan-gaprow" key={row.kind}>
                    <button type="button" aria-pressed={selectedRow} onClick={() => setTargetKind(row.kind)}>
                      <div className="ngt-plan-gaphead" data-selected={selectedRow}>
                        <span>{row.kindLabel} · {row.track}{row.latest ? " (" + dayMonth(row.latest.date) + (row.latest.old ? "/" + new Date(row.latest.date).getUTCFullYear() : "") + ")" : ""}</span>
                        <span className={pct === null ? "ngt-plan-mu" : pct <= 0.5 ? "ngt-plan-gain" : pct >= 1.5 ? "ngt-plan-loss" : undefined}>{pct === null ? "sem corrida" : pt(pct, 2) + "%"}</span>
                      </div>
                      {row.latest ? (
                        <>
                          <div className="ngt-plan-note" style={{ margin: "2px 0 6px" }}>{formatLap(row.latest.own)} vs {formatLap(row.latest.classBest)} · +{formatSeconds(row.latest.own - row.latest.classBest)} s{row.latest.old ? " · dado antigo" : ""}</div>
                          <div className="ngt-plan-track"><div className="ngt-plan-fill" data-tone={pct !== null && pct <= 0.5 ? "gain" : pct !== null && pct >= 1.5 ? "loss" : undefined} style={{ width: Math.max(4, maxGap ? (pct ?? 0) / maxGap * 100 : 0) + "%" }} /></div>
                        </>
                      ) : <div className="ngt-plan-note" style={{ margin: "2px 0 0" }}>Nenhuma corrida com volta e referência da classe neste contexto.</div>}
                    </button>
                  </div>
                );
              })}
              {targetRow && evolution.length >= 2 ? (
                <>
                  <div className="ng-eyebrow" style={{ margin: "12px 0 8px" }}>{targetRow.kindLabel} · {targetRow.track} · evolução do gap (%)</div>
                  <div className="ngt-plan-evol" role="img" aria-label={"Gap para a melhor volta da classe: " + evolution.map((point) => pt(point.pct, 2) + "% em " + dayMonth(point.date)).join(", ")}>
                    {evolution.map((point, index) => <div key={point.raceId} data-tone={index === evolution.length - 1 && point.pct < evolution[0].pct ? "gain" : undefined} style={{ height: Math.max(6, maxEvolution ? point.pct / maxEvolution * 96 : 6) }} />)}
                  </div>
                  <div className="ngt-plan-evol-l">{evolution.map((point) => <span key={point.raceId}>{dayMonth(point.date)}</span>)}</div>
                  <p className="ngt-plan-note">Nas últimas {evolution.length} corridas na pista o gap foi de {pt(evolution[0].pct, 2)}% para {pt(evolution[evolution.length - 1].pct, 2)}%.</p>
                </>
              ) : <p className="ngt-plan-note">Sem corridas suficientes na pista para mostrar a evolução do gap (mínimo 2).</p>}
            </>
          ) : <p className="ngt-plan-line">Nenhum contexto da semana tem corrida com volta e referência da classe.</p>}
        </Panel>
      </div>
    </div>
  );
}

function IdealView({ ideal, carClass }: { ideal: IdealLap; carClass: string | null }) {
  const maxLost = Math.max(...ideal.sectors.map((row) => row.lost), 0);
  const level = (lost: number) => (lost <= 0 || maxLost <= 0 ? "" : lost / maxLost >= 0.66 ? "a" : lost / maxLost >= 0.33 ? "b2" : "c");
  const worstSigma = Math.max(...ideal.sectors.map((row) => row.sigma));
  const label = "Setores: " + ideal.sectors.map((row) => "S" + row.sector + (row.lost > 0 ? " perde " + pt(row.lost, 3) + " s" : " no melhor tempo")).join(", ");
  return (
    <>
      <div className="ngt-plan-strip" role="img" aria-label={label}>
        {ideal.sectors.map((row) => (
          <div key={row.sector} className={"s " + level(row.lost)} style={{ flex: row.mean }}><b>S{row.sector}</b>{row.lost > 0 ? "−" + pt(row.lost, 3) : "ideal"}</div>
        ))}
      </div>
      <div className="ngt-plan-sig" aria-hidden>
        {ideal.sectors.map((row) => <span key={row.sector} style={{ flex: row.mean, color: row.sigma === worstSigma ? "var(--ng-loss)" : undefined }}>σ {pt(row.sigma, 3)}</span>)}
      </div>
      <div className="ngt-plan-scroll" style={{ marginTop: 12 }}><table className="ngt-plan-table">
        <thead><tr><th>Setor</th><th className="r">Sua volta</th><th className="r">Melhor</th><th className="r">Perdido</th><th className="r">Variação (σ)</th></tr></thead>
        <tbody>
          {ideal.sectors.map((row) => (
            <tr key={row.sector}>
              <td>S{row.sector}</td><td className="r">{pt(row.own, 3)}</td><td className="r">{pt(row.best, 3)}</td>
              <td className={"r " + (row.lost > 0 ? "ngt-plan-loss" : "ngt-plan-gain")}>{pt(row.lost, 3)}</td>
              <td className={"r" + (row.sigma === worstSigma ? " ngt-plan-loss" : "")}>{pt(row.sigma, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="ngt-plan-note">Base: as {ideal.lapsUsed} voltas limpas mais rápidas deste carro{carClass ? " (" + carClass + ")" : ""} nesta pista, nesta season (laps + lap_sectors, sem sessões offline). Perdido = setor da sua melhor volta menos o melhor setor; σ = desvio padrão do setor nessas voltas.</p>
    </>
  );
}
