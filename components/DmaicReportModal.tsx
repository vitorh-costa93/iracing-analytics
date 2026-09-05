"use client";
import { useEffect, useState } from "react";

type Scope = "week" | "season";
type Section = { category: "formula_car" | "sports_car"; week?: number | null; paragraphs: string[] };
type Report = { seasonName:string; previousSeasonName:string; sections:Section[]; message?:string };

const label=(c:Section["category"])=>c==="formula_car"?"Formula Car":"Sports Car";
const evidence=(text:string)=> text.includes("incidente")?"incidents":text.includes("SoF")?"sof":text.includes("iRating")?"rating":"pace";

export default function DmaicReportModal(){
 const [scope,setScope]=useState<Scope|null>(null),[report,setReport]=useState<Report|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{if(!scope)return;let cancelled=false;setReport(null);setError(null);
 fetch(`/api/dashboard/report?scope=${scope}`,{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.message??"Não foi possível gerar o debrief.");return d as Report}).then(d=>!cancelled&&setReport(d)).catch(e=>!cancelled&&setError(e instanceof Error?e.message:"Erro ao gerar debrief."));
 return()=>{cancelled=true}},[scope]);
 if(!scope)return <div className="dmaic-report-actions"><button type="button" className="quick-open-button" onClick={()=>setScope("week")}>Debrief da semana</button><button type="button" className="primary-button" onClick={()=>setScope("season")}>Debrief da season</button></div>;
 const title=scope==="week"?"Debrief de corrida · semana":"Debrief de corrida · season";
 return <div className="dmaic-modal-backdrop" role="presentation" onMouseDown={()=>setScope(null)}><section className="dmaic-modal engineer-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}>
 <header className="dmaic-modal-head"><div><span className="section-kicker">RACE ENGINEER</span><h2>{title}</h2><p>{report?`${report.seasonName} vs. ${report.previousSeasonName}`:"Cruzando resultados, ritmo, incidentes e contexto competitivo..."}</p></div><button type="button" className="modal-close" onClick={()=>setScope(null)}>Fechar</button></header>
 {error&&<p className="dmaic-error">{error}</p>}{!report&&!error&&<div className="state-box">Montando o debrief com dados reais...</div>}
 {report?.sections.map(s=><article className="dmaic-section engineer-section" key={s.category}><h3>{label(s.category)}{s.week?` · Week ${s.week}`:""}</h3><div className="engineer-reading"><strong>Leitura do engenheiro</strong><p>{scope==="week"?"O foco é identificar o que decidiu esta week: resultado, risco, ritmo e contexto de grid.":"O foco é explicar a diferença acumulada: frequência de bons resultados, perdas grandes e onde elas acontecem."}</p></div><div className="evidence-list">{s.paragraphs.map((p,i)=><div className={`evidence-row ${evidence(p)}`} key={i}><span>{i===0?"RESULTADO":evidence(p).toUpperCase()}</span><p>{p}</p></div>)}</div><div className="engineer-action"><strong>Próxima ação</strong><p>{scope==="week"?"Antes da próxima corrida, revise as voltas com off-track, descontinuidade e tow. Em treino, compare três voltas limpas consecutivas contra sua melhor volta — dispersão menor é o sinal de confiança que importa.":"Ataque primeiro o carro+pista com pior média em amostra de duas ou mais corridas. Separe off-tracks de retiradas (tow) e de contatos confirmados; não trate todos como o mesmo problema."}</p></div><p className="engineer-note">Incidentes totais vêm do resultado oficial. Off-track, descontinuidade e tow só serão classificados quando a telemetria/sincronização trouxer esse evento explicitamente; o sistema não chamará uma retirada de colisão sem evidência.</p></article>)}
 </section></div>
}