"use client";

import { useEffect, useState } from "react";

type ChannelStat = { channel: string; label: string; avgScore: number };
type CategoryDebrief = {
  session: { startedAt: string; endedAt: string; durationMinutes: number; car: string; track: string } | null;
  message?: string;
  lapsAnalyzed?: number;
  overtakeExcluded?: number;
  bestLap?: string;
  worstLap?: string;
  lapTimeSpread?: string;
  lapTimeStddev?: string;
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  channelStats?: ChannelStat[];
};
type Category = "formula_car" | "sports_car";
const CATEGORY_LABEL: Record<Category, string> = { formula_car: "Formula Car", sports_car: "Sports Car" };

export default function RaceDebrief() {
  const [categories, setCategories] = useState<Record<Category, CategoryDebrief> | null>(null);
  const [selected, setSelected] = useState<Category>("formula_car");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/telemetry/debrief", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao gerar o debrief");
        setCategories(result.categories);
        if (!result.categories?.formula_car?.session && result.categories?.sports_car?.session) setSelected("sports_car");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) return <div className="telemetry-state">Buscando sua última corrida válida (mínimo 15 minutos) em cada categoria e baixando telemetria das melhores voltas...</div>;
  if (error) return <div className="telemetry-state error">{error}</div>;

  const data = categories?.[selected];

  return (
    <div className="race-debrief">
      <div className="race-debrief-category-toggle">
        {(["formula_car", "sports_car"] as Category[]).map((category) => (
          <button key={category} className={selected === category ? "active" : ""} onClick={() => setSelected(category)}>{CATEGORY_LABEL[category]}</button>
        ))}
      </div>

      {!data?.session ? (
        <div className="telemetry-state">{data?.message ?? "Nenhuma corrida elegível encontrada."}</div>
      ) : (
        <>
          <div className="race-debrief-header">
            <div>
              <span className="section-kicker">DEBRIEF DA CORRIDA</span>
              <h3>{data.session.car} — {data.session.track}</h3>
              <p>{new Date(data.session.startedAt).toLocaleString("pt-BR")} • {data.session.durationMinutes} min de corrida • {data.lapsAnalyzed} voltas analisadas{data.overtakeExcluded ? ` • ${data.overtakeExcluded} com overtake descartada(s)` : ""}</p>
            </div>
          </div>

          <div className="race-debrief-summary">
            <p>{data.summary}</p>
            <div className="race-debrief-metrics">
              <div><span>MELHOR VOLTA</span><strong>{data.bestLap}</strong></div>
              <div><span>PIOR DAS ANALISADAS</span><strong>{data.worstLap}</strong></div>
              <div><span>VARIAÇÃO (SPREAD)</span><strong>{data.lapTimeSpread}s</strong></div>
              <div><span>DESVIO PADRÃO</span><strong>{data.lapTimeStddev}s</strong></div>
            </div>
          </div>

          <div className="race-debrief-columns">
            <div className="race-debrief-col strengths">
              <span className="section-kicker">PONTOS FORTES</span>
              <h4>O que manter</h4>
              {data.strengths?.map((text) => <p key={text}>{text}</p>)}
            </div>
            <div className="race-debrief-col improvements">
              <span className="section-kicker">PONTOS DE MELHORIA</span>
              <h4>Onde focar no treino</h4>
              {data.improvements?.map((text) => <p key={text}>{text}</p>)}
            </div>
          </div>

          <div className="race-debrief-channels">
            <span className="section-kicker">CONSISTÊNCIA POR CANAL</span>
            <p className="race-debrief-channels-note">Quanto menor a barra, mais você repete o mesmo padrão entre as voltas nesse canal.</p>
            <div className="race-debrief-channel-bars">
              {data.channelStats?.slice().sort((a, b) => a.avgScore - b.avgScore).map((item) => {
                const max = Math.max(...(data.channelStats ?? []).map((stat) => stat.avgScore), 0.01);
                return (
                  <div className="race-debrief-channel-row" key={item.channel}>
                    <span>{item.label}</span>
                    <div className="race-debrief-channel-track"><div style={{ width: `${Math.max(4, (item.avgScore / max) * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
