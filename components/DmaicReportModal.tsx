"use client";

import { useEffect, useState } from "react";

type Scope = "week" | "season";
type Section = { category: "formula_car" | "sports_car"; week?: number | null; paragraphs: string[] };
type Report = {
  status: string;
  scope: Scope;
  seasonName: string;
  previousSeasonName: string;
  generatedAt: string;
  sections: Section[];
  message?: string;
};

function categoryName(category: Section["category"]) {
  return category === "formula_car" ? "Formula Car" : "Sports Car";
}

export default function DmaicReportModal() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    fetch(`/api/dashboard/report?scope=${scope}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "Não foi possível gerar o relatório.");
        return data as Report;
      })
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Erro ao gerar o relatório."); });
    return () => { cancelled = true; };
  }, [scope]);

  if (!scope) {
    return (
      <div className="dmaic-report-actions">
        <button type="button" className="quick-open-button" onClick={() => setScope("week")}>Resumo da semana</button>
        <button type="button" className="primary-button" onClick={() => setScope("season")}>Resumo da season</button>
      </div>
    );
  }

  const title = scope === "week" ? "Resumo DMAIC da semana" : "Resumo DMAIC da season";
  return (
    <div className="dmaic-modal-backdrop" role="presentation" onMouseDown={() => setScope(null)}>
      <section className="dmaic-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="dmaic-modal-head">
          <div>
            <span className="section-kicker">ANÁLISE DMAIC</span>
            <h2>{title}</h2>
            <p>{report ? `${report.seasonName} vs. ${report.previousSeasonName}` : "Cruzando resultados, iRating, SoF, incidentes e Safety Rating..."}</p>
          </div>
          <button type="button" className="modal-close" onClick={() => setScope(null)} aria-label="Fechar análise">Fechar</button>
        </header>

        {error && <p className="dmaic-error">{error}</p>}
        {!report && !error && <div className="state-box">Gerando análise com dados reais...</div>}

        {report?.sections.map((section) => (
          <article className="dmaic-section" key={section.category}>
            <h3>{categoryName(section.category)}{section.week ? ` · Week ${section.week}` : ""}</h3>
            <div className="dmaic-stage">
              <strong>D · Definir</strong>
              <p>{scope === "week" ? "Avaliar se o resultado da week está acima ou abaixo do próprio histórico e da mesma week da season anterior." : "Avaliar por que o resultado acumulado da season diverge da season anterior, sem confundir vitórias com evolução de iRating."}</p>
            </div>
            <div className="dmaic-stage">
              <strong>M · Medir</strong>
              <p>Usa somente resultados oficiais já importados, iRating por corrida, SoF, incidentes e Safety Rating disponível. Conclusões com amostra pequena permanecem hipóteses.</p>
            </div>
            <div className="dmaic-stage">
              <strong>A · Analisar</strong>
              {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
            <div className="dmaic-stage">
              <strong>I · Melhorar</strong>
              <p>Escolha um único contexto ruim (carro + pista ou fase de curva), altere uma variável por vez e compare pelo menos três voltas consistentes com o mesmo combustível.</p>
            </div>
            <div className="dmaic-stage">
              <strong>C · Controlar</strong>
              <p>Acompanhe o delta de iRating, incidentes e Safety Rating nas próximas corridas. Se o sinal não melhorar depois do teste, reabra a hipótese em vez de acumular ajustes.</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
