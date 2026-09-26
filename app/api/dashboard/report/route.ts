import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildEngineerSection, Category, RaceInput } from "@/lib/race-engineer-analysis";
import { currentSeasonWeek } from "@/lib/season-week";
import { retirementEvents } from "@/lib/race-retirement-events";
import { telemetryInputProfile } from "@/lib/telemetry-input-profile";
import { paceVsResultInsight } from "@/lib/pace-vs-result-insight";
import { buildRecommendation } from "@/lib/recommendation";
import { paceConsistencyNote } from "@/lib/pace-consistency-note";
import { buildPaceChart, currentStreak, inputConsistencyPct, longestStreak, lossTimingBins, PACE_OUTLIER_PCT } from "@/lib/debrief-charts";
import { dec, lossTimingText, quickSummary, weekPressureSubtitle, weekRacesSubtitle } from "@/lib/debrief-narrative";
import type { DebriefContextRow, DebriefRaceRow, DebriefReport, DebriefSection } from "@/lib/debrief-types";

export const dynamic="force-dynamic";
export const maxDuration=300;
const CATEGORIES:Category[]=["formula_car","sports_car"];
const SEGMENTS=[
 {id:"formula",label:"Super Formula",category:"formula_car" as Category,match:(_row:{series_name:string})=>true},
 {id:"gt3",label:"GT3",category:"sports_car" as Category,match:(row:{series_name:string})=>row.series_name.toLowerCase().includes("gt3")},
 {id:"imsa",label:"IMSA",category:"sports_car" as Category,match:(row:{series_name:string})=>row.series_name.toLowerCase().includes("imsa")},
];
// PERMANENT GUARD-RAIL (CLAUDE.md "Non-negotiable rules" #7) -- não remover nem aumentar o TTL sem
// pedido explícito. Relatório caro (varre a temporada inteira + telemetria) chamado a cada troca de
// aba dos Debriefs -- sem cache aqui, rajadas de cliques disparavam a mesma consulta ao Supabase
// repetidas vezes por minuto, e como os dados de base mudam pouco, a maior parte batia no cache
// interno do Supabase e estourou a cota gratuita de "Cached Egress" da organização (~8,3GB/5GB no
// ciclo de 09/08-09/09/2026). Cache em memória por instância, chaveado por scope+segment, no mesmo
// padrão do /api/dashboard/overview.
const reportCache=new Map<string,{expiresAt:number;payload:unknown}>();
const REPORT_CACHE_TTL_MS=120_000;
// 25/09/2026 (redesign etapa 5): o KPI "Sequência" mostra o recorde de todos os tempos, então lê o
// histórico anterior à janela do relatório -- só 4 colunas leves de race_results (resultados oficiais
// do iRStats, que só guarda corridas), paginado e com o mesmo TTL do relatório, compartilhado entre
// os 6 recortes (scope × segmento) para não repetir a consulta a cada troca de aba.
const historyCache=new Map<string,{expiresAt:number;promise:Promise<HistoryRow[]>}>();
type HistoryRow={raced_at:string;category:Category;series_name:string;irating_delta:number|null};
const total=(values:number[])=>values.reduce((a,b)=>a+b,0);
const delta=(row:RaceInput)=>row.irating_after-row.irating_before;
const round=(value:number|null,decimals=1)=>value===null?null:Number(value.toFixed(decimals));
function fail(source:string,error:unknown):never{const value=error&&typeof error==="object"?error as Record<string,unknown>:{};throw new Error(source+": "+(typeof value.message==="string"?value.message:String(error)))}
async function racesFor(driverId:string,start:string,end:string){const all:RaceInput[]=[];for(let from=0;;from+=1000){const{data,error}=await supabaseAdmin.from("v_race_results_irating").select("raced_at,category,series_name,track_name,car_name,season_week,finish_position,grid_position,position_change,irating_after,irating_before,sof,incidents,laps,fastest_lap_time").eq("driver_id",driverId).gte("raced_at",start).lt("raced_at",end).in("category",CATEGORIES).order("raced_at",{ascending:true}).range(from,from+999);if(error)fail("v_race_results_irating",error);all.push(...((data??[])as RaceInput[]));if(!data||data.length<1000)return all}}
function historyBefore(driverId:string,before:string){const key=driverId+"|"+before,cached=historyCache.get(key);if(cached&&cached.expiresAt>Date.now())return cached.promise;const promise=(async()=>{const all:HistoryRow[]=[];for(let from=0;;from+=1000){const{data,error}=await supabaseAdmin.from("race_results").select("raced_at,category,series_name,irating_delta").eq("driver_id",driverId).lt("raced_at",before).in("category",CATEGORIES).order("raced_at",{ascending:true}).range(from,from+999);if(error)fail("race_results",error);all.push(...((data??[])as HistoryRow[]));if(!data||data.length<1000)return all}})();historyCache.set(key,{expiresAt:Date.now()+REPORT_CACHE_TTL_MS,promise});promise.catch(()=>historyCache.delete(key));return promise}

const raceRow=(row:RaceInput,lossTotal:number,threshold:number):DebriefRaceRow=>({date:row.raced_at,track:row.track_name,car:row.car_name,grid:row.grid_position,finish:row.finish_position,sof:row.sof,delta:delta(row),lossShare:delta(row)<0&&lossTotal?Math.round(Math.abs(delta(row))/lossTotal*100):null,severe:delta(row)<-threshold});
function contexts(rows:RaceInput[]){const groups=new Map<string,RaceInput[]>();for(const row of rows){const key=row.track_name+"|"+row.car_name;groups.set(key,[...(groups.get(key)??[]),row])}const list:DebriefContextRow[]=[...groups.values()].map(items=>({track:items[0].track_name,car:items[0].car_name,races:items.length,delta:total(items.map(delta))}));return{losses:list.filter(item=>item.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,3),gains:list.filter(item=>item.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,3)}}

export async function GET(request:NextRequest){
 try{
  const scope=request.nextUrl.searchParams.get("scope")==="week"?"week":"season",requestedSegment=request.nextUrl.searchParams.get("segment")??"formula",segment=SEGMENTS.find(item=>item.id===requestedSegment)??SEGMENTS[0];
  const cacheKey=scope+"|"+segment.id,cached=reportCache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now())return NextResponse.json(cached.payload,{headers:{"Cache-Control":"private, max-age=120, stale-while-revalidate=300"}});
  const{data:driver,error:driverError}=await supabaseAdmin.from("drivers").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();if(driverError)fail("drivers",driverError);if(!driver)throw new Error("Nenhum piloto encontrado no Supabase.");
  const{data:summary,error:summaryError}=await supabaseAdmin.from("v_season_summary").select("season_id,season_name");if(summaryError)fail("v_season_summary",summaryError);const seasons=[...(summary??[])].sort((a,b)=>Number(b.season_id)-Number(a.season_id)),current=seasons[0],previous=seasons[1];if(!current||!previous)throw new Error("São necessárias duas seasons para comparar.");
  const{data:calendar,error:calendarError}=await supabaseAdmin.from("v_season_calendar").select("season_id,season_start").in("season_id",[String(current.season_id),String(previous.season_id)]);if(calendarError)fail("v_season_calendar",calendarError);const byId=new Map((calendar??[]).map(x=>[String(x.season_id),x])),currentStart=byId.get(String(current.season_id))?.season_start,previousStart=byId.get(String(previous.season_id))?.season_start;if(!currentStart||!previousStart)throw new Error("Calendário sem início das seasons.");
  const[rows,history]=await Promise.all([racesFor(driver.id,previousStart,new Date(new Date(currentStart).getTime()+84*86400000).toISOString()),historyBefore(driver.id,previousStart)]);
  const currentRows=rows.filter(x=>new Date(x.raced_at)>=new Date(currentStart)),previousRows=rows.filter(x=>new Date(x.raced_at)<new Date(currentStart));

  const now=currentRows.filter(row=>row.category===segment.category&&segment.match(row)),before=previousRows.filter(row=>row.category===segment.category&&segment.match(row)),latestWeek=currentSeasonWeek(currentRows),selected=scope==="week"&&latestWeek!==null?now.filter(row=>row.season_week===latestWeek):now,baseline=scope==="week"&&latestWeek!==null?now.filter(row=>row.season_week!==latestWeek):before;
  const contextKey=(row:RaceInput)=>row.car_name+"|"+row.track_name,sharedContexts=new Set([...new Set(selected.map(contextKey))].filter(key=>baseline.some(row=>contextKey(row)===key)));
  const[survival,survivalReference,inputs,inputReference]=await Promise.all([retirementEvents(driver.id,selected,current.season_name),retirementEvents(driver.id,baseline,scope==="week"?current.season_name:previous.season_name),telemetryInputProfile(driver.id,segment.category,selected,current.season_name,scope==="week"?latestWeek:null,sharedContexts),telemetryInputProfile(driver.id,segment.category,baseline,scope==="week"?current.season_name:previous.season_name,null,sharedContexts)]);
  const base=buildEngineerSection(segment.category,selected,baseline,scope,scope==="week"?latestWeek:null,segment.label,segment.id),threshold=base.severity.threshold;
  const ordered=[...selected].sort((a,b)=>new Date(a.raced_at).getTime()-new Date(b.raced_at).getTime());
  const net=total(selected.map(delta)),referenceTotal=total(baseline.map(delta)),gainTotal=total(selected.map(delta).filter(v=>v>0)),lossTotal=Math.abs(total(selected.map(delta).filter(v=>v<0))),severeLossTotal=Math.abs(total(selected.map(delta).filter(v=>v<-threshold)));
  // Comparação justa: season contra a season anterior inteira (saldo total); week contra a média por
  // corrida das demais weeks (regra de 09/09/2026: não comparar uma week com a soma de onze).
  const netCompare=scope==="week"?(selected.length?net/selected.length:0):net,referenceCompare=scope==="week"?(baseline.length?referenceTotal/baseline.length:0):referenceTotal,netBetter=baseline.length>0&&netCompare>referenceCompare,netWorse=baseline.length>0&&netCompare<referenceCompare;

  // Ritmo × resultado: todas as corridas do segmento nas duas seasons definem a referência de volta.
  const pace=buildPaceChart(scope,selected,[...before,...now]);
  const timing=lossTimingBins(survival.raceProgress,threshold),timingReference=lossTimingBins(survivalReference.raceProgress,threshold);
  const topBin=timing.sample?timing.bins.indexOf(Math.max(...timing.bins)):-1,lossFocus=topBin>=0&&timing.bins.filter(v=>v===timing.bins[topBin]).length===1?{bin:topBin,count:timing.bins[topBin]}:null;

  // Sequência atual e recorde de todos os tempos (histórico anterior + janela carregada).
  const historyDeltas=history.filter(row=>row.category===segment.category&&segment.match(row)&&typeof row.irating_delta==="number").map(row=>row.irating_delta as number);
  const windowRows=[...before,...now].sort((a,b)=>new Date(a.raced_at).getTime()-new Date(b.raced_at).getTime());
  const allDeltas=[...historyDeltas,...windowRows.map(delta)],streak=currentStreak(allDeltas);
  const periodDeltas=ordered.map(delta),baselineDeltas=[...baseline].sort((a,b)=>new Date(a.raced_at).getTime()-new Date(b.raced_at).getTime()).map(delta);

  const gapDeltaSeconds=inputs.averageGapToBestSeconds!==null&&inputReference.averageGapToBestSeconds!==null?inputs.averageGapToBestSeconds-inputReference.averageGapToBestSeconds:null,stdDeltaSeconds=inputs.lapStdDevSeconds!==null&&inputReference.lapStdDevSeconds!==null?inputs.lapStdDevSeconds-inputReference.lapStdDevSeconds:null;
  const MATERIAL_SECONDS=0.02,incidentsNow=base.incidentSummary.current.average,incidentsRef=base.incidentSummary.reference.average,incidentsWorse=incidentsNow!==null&&incidentsRef!==null&&incidentsNow-incidentsRef>=1;

  // Week: saldo desta week comparado às demais weeks da season, para "melhor/pior week".
  const weekTotals=new Map<number,number>();for(const row of now)if(row.season_week!==null)weekTotals.set(row.season_week,(weekTotals.get(row.season_week)??0)+delta(row));
  const weekValues=[...weekTotals.values()],weekRank=scope==="week"&&weekValues.length?{best:net>=Math.max(...weekValues),worst:net<=Math.min(...weekValues),weeks:weekValues.length}:undefined;

  const summaryText=quickSummary({scope,races:selected.length,referenceRaces:baseline.length,net,referenceNet:referenceTotal,wins:selected.filter(row=>row.finish_position===1).length,referenceWins:scope==="week"?0:baseline.filter(row=>row.finish_position===1).length,severeCount:base.severity.count,severeLossTotal,gainTotal,lossTotal,incidentsNow,incidentsRef,weekRank});
  const paceText=paceVsResultInsight({unit:pace.unit,points:pace.points,quadrants:pace.quadrants,split:pace.split,netWorse,netBetter,gapDeltaSeconds});
  const action=buildRecommendation({net,netBetter,netWorse,paceImproved:gapDeltaSeconds!==null&&gapDeltaSeconds<-MATERIAL_SECONDS,consistencyImproved:stdDeltaSeconds!==null&&stdDeltaSeconds<-MATERIAL_SECONDS,paceWorsened:gapDeltaSeconds!==null&&gapDeltaSeconds>MATERIAL_SECONDS,severeCount:base.severity.count,lossFocus,fastLoss:pace.quadrants.fastLoss,pacePoints:pace.points.length,incidentsWorse});
  const lossTiming=lossTimingText({scope,severeCount:base.severity.count,bins:timing.bins,sample:timing.sample,averagePct:timing.averagePct,referenceSample:timingReference.sample,referenceAveragePct:timingReference.averagePct});
  const weeks=base.weeklyImpact.map(item=>({week:item.week,delta:item.delta??0,races:item.races,severeLosses:item.severeLosses}));
  const trendSubtitle=scope==="week"?weekRacesSubtitle(base.severity.count,selected.length):weekPressureSubtitle(weeks);
  const confidenceLabel=base.confidence as DebriefSection["confidence"];
  const incidentStats=(value:typeof base.incidentSummary.current)=>({races:value.races,average:value.average,highCount:value.highCount,highRate:value.highRate});
  const pedal=(profile:typeof inputs)=>({brake:inputConsistencyPct(profile.brakeRepeatabilityPct),throttle:inputConsistencyPct(profile.throttleRepeatabilityPct),steering:inputConsistencyPct(profile.steeringRepeatabilityPct)});
  const splitText=pace.split===null?"":" Hoje o seu normal é "+dec(pace.split,2)+"%.";
  const section:DebriefSection={
   segment:segment.id,label:segment.label,week:scope==="week"?latestWeek:null,confidence:confidenceLabel,races:selected.length,referenceRaces:baseline.length,
   narrative:{summary:summaryText,paceVsResult:paceText,action,lossTiming,trendSubtitle},
   kpis:{net,referenceNet:baseline.length?round(referenceCompare,1):null,severeCount:base.severity.count,severeThreshold:threshold,retirements:survival.events.length,retirementRate:selected.length?Math.round(survival.events.length/selected.length*100):null,incidentsAvg:incidentsNow,incidentsRef,streak:{length:streak.length,direction:streak.direction,recordGain:longestStreak(allDeltas,"gain"),recordLoss:longestStreak(allDeltas,"loss")}},
   pace,
   lossTiming:{current:timing.bins,reference:timingReference.bins,currentSample:timing.sample,referenceSample:timingReference.sample},
   weeks,
   raceList:scope==="week"?[...ordered].reverse().map(row=>raceRow(row,lossTotal,threshold)):[],
   impactRaces:[...selected].sort((a,b)=>Math.abs(delta(b))-Math.abs(delta(a))).slice(0,4).map(row=>raceRow(row,lossTotal,threshold)),
   contexts:contexts(selected),
   evidence:{
    incidents:{current:incidentStats(base.incidentSummary.current),reference:incidentStats(base.incidentSummary.reference)},
    retirements:{items:survival.events.slice(0,12).map(event=>{const[car,track]=event.context.split(" • ");return{date:event.racedAt,track:track??event.context,car:car??"",type:event.confidence==="probable"?"Provável abandono (saiu antes de 80% da corrida)":event.type,confidence:event.confidence,completedLaps:event.completedLaps,delta:event.delta}}),currentCount:survival.events.length,referenceCount:survivalReference.events.length,currentRate:selected.length?Math.round(survival.events.length/selected.length*100):null,referenceRate:baseline.length?Math.round(survivalReference.events.length/baseline.length*100):null},
    pedals:{current:pedal(inputs),reference:pedal(inputReference),laps:inputs.laps,referenceLaps:inputReference.laps,gapDeltaSeconds:round(gapDeltaSeconds,3),stdDeltaSeconds:round(stdDeltaSeconds,3),note:paceConsistencyNote(gapDeltaSeconds,stdDeltaSeconds)},
    streaks:{gain:longestStreak(periodDeltas,"gain"),loss:longestStreak(periodDeltas,"loss"),referenceGain:longestStreak(baselineDeltas,"gain"),referenceLoss:longestStreak(baselineDeltas,"loss"),recordGain:longestStreak(allDeltas,"gain")},
    method:[
     "Só corridas oficiais importadas do iRStats. Treino e classificação não entram.",
     scope==="week"?"Referência: as outras weeks desta season. O saldo delas é comparado por corrida, para ser justo com uma week só.":"Referência: a season anterior inteira, no mesmo segmento.",
     "Perda grande: corrida em que você perdeu mais de "+threshold+" pontos de iRating.",
     "Ritmo: sua melhor volta em cada corrida, comparada à sua melhor volta de corrida no mesmo carro e pista (nesta season e na anterior). Corridas mais de "+PACE_OUTLIER_PCT+"% longe disso ficam de fora.",
     "Rápido ou devagar: comparado à sua distância típica nessas corridas."+splitText,
     "Quando a perda aconteceu: quanto tempo você ficou na pista naquela corrida, comparado à sua corrida mais longa no mesmo carro e pista (telemetria do Garage61).",
     "Incidentes: o iRacing só guarda o total por corrida. 4 pontos ou mais costuma indicar contato, mas não confirma.",
     "Constância dos pedais: o quanto o uso de freio, acelerador e volante se repete de uma volta para outra (100% = sempre igual), só em voltas limpas de corrida.",
    ],
   },
  };
  const payload:DebriefReport={status:"ok",scope,seasonName:current.season_name,previousSeasonName:previous.season_name,generatedAt:new Date().toISOString(),sections:[section]};
  reportCache.set(cacheKey,{expiresAt:Date.now()+REPORT_CACHE_TTL_MS,payload});
  return NextResponse.json(payload,{headers:{"Cache-Control":"private, max-age=120, stale-while-revalidate=300"}});
 }catch(error){return NextResponse.json({status:"error",message:error instanceof Error?error.message:String(error)},{status:500})}
}
