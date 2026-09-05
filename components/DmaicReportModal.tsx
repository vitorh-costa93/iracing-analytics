"use client";
import { useEffect, useState } from "react";

type Scope = "week" | "season";
type Group = { label: string; races: number; delta: number; avgDelta: number; avgIncidents: number | null; avgPositionChange: number | null; avgSof: number | null };
type Finding = { kind: "finding" | "watch" | "data"; title: string; text: string };
type Context = { context: string; races: number; delta: number; avgDelta: number; wins: number; avgIncidents: number | null; avgPositionChange: number | null; shareOfLosses?: number };
type Section = {
  category: "formula_car" | "sports_car"; label: string; week: number | null; confidence: string; headline: string; comparison: string; findings: Finding[]; action: string;
  metrics: { races: number; wins: number; podiums: number; netDelta: number | null; totalIncidents: number; averageIncidents: number | null; averagePositionChange: number | null; averageSof: number | null };
  outcomeDistribution: Group[]; incidentDistribution: Group[]; positionDistribution: Group[]; topLosses: Context[]; topGains: Context[]; telemetryNote: string;
};
type Report = { seasonName: string; previousSeasonName: string; sections: Section[]; methodology: string };

const n = (value: number | null, digits = 1) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const category = (value: Section["category"]) => value === "formula_car" ? "Formula Car" : "Sports Car";
function Bars({ title, items }: { title: string; items: Group[] }) {
  const max = Math.max(1, ...items.map((item) => Math.abs(item.delta)));
  return <section style={{border:"1px solid var(--border)",padding:14,background:"var(--surface)"}}><strong style={{fontSize:13}}>{title}</strong>
    <div style={{display:"grid",gap:10,marginTop:12}}>{items.map((item) => <div key={item.label}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,color:"var(--muted)"}}><span>{item.label} · {item.races} corridas</span><b style={{color:item.delta < 0 ? "var(--red)" : item.delta > 0 ? "var(--green)" : "var(--soft)"}}>{n(item.delta)}</b></div>
      <div style={{height:7,marginTop:5,background:"var(--surface-muted)",overflow:"hidden"}}><div style={{width:`${Math.max(3, Math.abs(item.delta) / max * 100)}%`,height:"100%",background:item.delta < 0 ? "var(--red)" : item.delta > 0 ? "var(--green)" : "var(--soft)"}} /></div>
      <small style={{display:"block",marginTop:3,color:"var(--soft)"}}>média {n(item.avgDelta)} · inc. {item.avgIncidents ?? "—"} · posições {n(item.avgPositionChange)}</small>
    </div>)}</div>
  </section>;
}
function ContextList({ title, items, loss }: { title: string; items: Context[]; loss?: boolean }) {
  return <section style={{border:"1px solid var(--border)",padding:14,background:"var(--surface)"}}><strong style={{fontSize:13}}>{title}</strong>
    <div style={{display:"grid",gap:10,marginTop:12}}>{items.length ? items.map((item) => <div key={item.context} style={{borderLeft:`3px solid ${loss ? "var(--red)" : "var(--green)"}`,paddingLeft:9}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8}}><b style={{fontSize:12}}>{item.context}</b><strong style={{color:loss ? "var(--red)" : "var(--green)"}}>{n(item.delta)}</strong></div>
      <small style={{color:"var(--muted)"}}>{item.races} corridas · média {n(item.avgDelta)} · incidentes {item.avgIncidents ?? "—"} · posições {n(item.avgPositionChange)}{loss && item.shareOfLosses !== undefined ? ` · ${item.shareOfLosses}% das perdas` : ""}</small>
    </div>) : <small style={{color:"var(--muted)"}}>Ainda não há contexto suficiente.</small>}</div>
  </section>;
}

export default function DmaicReportModal() {
  const [scope, setScope] = useState<Scope | null>(null), [report, setReport] = useState<Report | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false; setReport(null); setError(null);
    fetch(`/api/dashboard/report?scope=${scope}`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Não foi possível montar o debrief."); return data as Report; })
      .then(data => !cancelled && setReport(data)).catch(reason => !cancelled && setError(reason instanceof Error ? reason.message : "Erro ao gerar debrief."));
    return () => { cancelled = true; };
  }, [scope]);

  if (!scope) return <div className="dmaic-report-actions"><button type="button" className="quick-open-button" onClick={() => setScope("week")}>Debrief da semana</button><button type="button" className="primary-button" onClick={() => setScope("season")}>Debrief da season</button></div>;
  const title = scope === "week" ? "Debrief da semana" : "Debrief da season";
  return <div className="dmaic-modal-backdrop" role="presentation" onMouseDown={() => setScope(null)}>
    <section className="dmaic-modal engineer-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()} style={{maxWidth:1120}}>
      <header className="dmaic-modal-head"><div><span className="section-kicker">RACE ENGINEER</span><h2>{title}</h2><p>{report ? `${report.seasonName} vs. ${report.previousSeasonName}` : "Cruzando corrida por corrida..."}</p></div><button type="button" className="modal-close" onClick={() => setScope(null)}>Fechar</button></header>
      {error && <p className="dmaic-error">{error}</p>}
      {!report && !error && <div className="state-box">Analisando resultado, SoF, posições e incidentes corrida a corrida...</div>}
      {report?.sections.map(section => <article key={section.category} style={{marginTop:18,paddingTop:18,borderTop:"1px solid var(--border)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline",flexWrap:"wrap"}}><h3 style={{margin:0}}>{category(section.category)}{section.week ? ` · Week ${section.week}` : ""}</h3><small style={{color:"var(--soft)",textTransform:"uppercase",letterSpacing:".08em"}}>confiança da amostra: {section.confidence}</small></div>
        <div style={{marginTop:12,padding:14,borderLeft:"3px solid var(--brand)",background:"var(--brand-pale)"}}><strong>{section.headline}</strong><p style={{margin:"6px 0 0",color:"var(--muted)",lineHeight:1.5}}>{section.comparison}</p></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,marginTop:12}}>{[
          ["Corridas",section.metrics.races],["Vitórias",section.metrics.wins],["Pódios",section.metrics.podiums],["Incidentes",section.metrics.totalIncidents],["Inc./corrida",section.metrics.averageIncidents ?? "—"],["Posições/corrida",n(section.metrics.averagePositionChange)],["SoF médio",section.metrics.averageSof?.toLocaleString("pt-BR") ?? "—"]
        ].map(([name,value]) => <div key={String(name)} style={{padding:"10px 11px",border:"1px solid var(--border)",background:"var(--surface-muted)"}}><small style={{display:"block",color:"var(--soft)"}}>{name}</small><strong>{value}</strong></div>)}</div>
        <h4 style={{margin:"20px 0 8px"}}>O que os dados explicam</h4>
        <div style={{display:"grid",gap:8}}>{section.findings.map((finding, index) => <div key={index} style={{padding:13,border:"1px solid var(--border)",borderLeft:`3px solid ${finding.kind === "finding" ? "var(--brand)" : finding.kind === "watch" ? "var(--amber)" : "var(--soft)"}`,background:"var(--surface)"}}><small style={{color:"var(--soft)",textTransform:"uppercase"}}>{finding.kind === "finding" ? "evidência" : finding.kind === "watch" ? "leitura a validar" : "limite de dados"}</small><strong style={{display:"block",marginTop:3}}>{finding.title}</strong><p style={{margin:"5px 0 0",color:"var(--muted)",lineHeight:1.5}}>{finding.text}</p></div>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10,marginTop:12}}><Bars title="Δ iRating por resultado" items={section.outcomeDistribution}/><Bars title="Δ iRating por carga de incidentes" items={section.incidentDistribution}/><Bars title="Δ iRating por posições" items={section.positionDistribution}/></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10,marginTop:10}}><ContextList title="Os contextos que mais puxaram para baixo" items={section.topLosses} loss/><ContextList title="Onde o resultado sustentou o saldo" items={section.topGains}/></div>
        <div style={{marginTop:12,padding:14,border:"1px solid var(--brand)",background:"var(--brand-pale)"}}><small style={{color:"var(--soft)",textTransform:"uppercase"}}>PRÓXIMA AÇÃO DE ENGENHARIA</small><p style={{margin:"5px 0 0",lineHeight:1.5}}>{section.action}</p></div>
        <p className="engineer-note">{section.telemetryNote}</p>
      </article>)}
      {report && <p className="engineer-note" style={{marginTop:18}}>{report.methodology}</p>}
    </section>
  </div>;
}
