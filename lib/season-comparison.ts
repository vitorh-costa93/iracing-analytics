import { RaceInput } from "@/lib/race-engineer-analysis";

const sum = (values: number[]) => values.reduce((a,b)=>a+b,0);
const avg = (values: Array<number|null>) => { const x=values.filter((v):v is number=>typeof v==="number"); return x.length ? sum(x)/x.length : null; };
const round = (value:number|null) => value===null?null:Number(value.toFixed(1));
const rate = (rows:RaceInput[], fn:(row:RaceInput)=>boolean) => rows.length ? (rows.filter(fn).length / rows.length) * 100 : null;
function snapshot(rows: RaceInput[]) {
  return {
    races: rows.length,
    wins: rows.filter(row=>row.finish_position===1).length,
    winRate: round(rate(rows,row=>row.finish_position===1)),
    podiumRate: round(rate(rows,row=>row.finish_position<=3)),
    positiveRate: round(rate(rows,row=>row.irating_after-row.irating_before>0)),
    averageDelta: round(avg(rows.map(row=>row.irating_after-row.irating_before))),
    averageIncidents: round(avg(rows.map(row=>row.incidents))),
    averagePositionChange: round(avg(rows.map(row=>row.position_change))),
    averageSof: round(avg(rows.map(row=>row.sof))),
    averageLoss: round(avg(rows.filter(row=>row.irating_after-row.irating_before<0).map(row=>row.irating_after-row.irating_before))),
  };
}
const numeric = (x:number|null,y:number|null)=>x===null||y===null?null:Number((x-y).toFixed(1));
export function compareSeasons(currentRows:RaceInput[], previousRows:RaceInput[]) {
 const current=snapshot(currentRows), previous=snapshot(previousRows);
 const entries=[
  {metric:"Taxa de vitórias", now:current.winRate, before:previous.winRate, good:"higher"},
  {metric:"Taxa de pódios", now:current.podiumRate, before:previous.podiumRate, good:"higher"},
  {metric:"Corridas ganhando iRating", now:current.positiveRate, before:previous.positiveRate, good:"higher"},
  {metric:"Δ iRating médio/corrida", now:current.averageDelta, before:previous.averageDelta, good:"higher"},
  {metric:"Incidentes por corrida", now:current.averageIncidents, before:previous.averageIncidents, good:"lower"},
  {metric:"Posições líquidas/corrida", now:current.averagePositionChange, before:previous.averagePositionChange, good:"higher"},
  {metric:"Severidade da corrida negativa", now:current.averageLoss, before:previous.averageLoss, good:"higher"},
 ].map(item=>{const change=numeric(item.now,item.before); const direction=change===null||Math.abs(change)<0.1?"stable":(item.good==="higher" ? change>0 : change<0)?"improved":"worsened"; return {...item,change,direction};});
 return {current,previous, improved:entries.filter(x=>x.direction==="improved"), worsened:entries.filter(x=>x.direction==="worsened"), stable:entries.filter(x=>x.direction==="stable")};
}