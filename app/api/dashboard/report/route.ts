import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildEngineerSection, Category, RaceInput } from "@/lib/race-engineer-analysis";
import { compareSeasons } from "@/lib/season-comparison";
import { retirementEvents } from "@/lib/race-retirement-events";
import { telemetryInputProfile } from "@/lib/telemetry-input-profile";

export const dynamic="force-dynamic";
export const maxDuration=300;
const CATEGORIES:Category[]=["formula_car","sports_car"];
const SEGMENTS=[
 {id:"formula",label:"Formula Car",category:"formula_car" as Category,match:(_row:RaceInput)=>true},
 {id:"gt3",label:"Sports Car · GT3",category:"sports_car" as Category,match:(row:RaceInput)=>row.series_name.toLowerCase().includes("gt3")},
 {id:"imsa",label:"Sports Car · IMSA",category:"sports_car" as Category,match:(row:RaceInput)=>row.series_name.toLowerCase().includes("imsa")},
];
// PERMANENT GUARD-RAIL (CLAUDE.md "Non-negotiable rules" #7) -- não remover nem aumentar o TTL sem
// pedido explícito. Relatório caro (varre a temporada inteira + telemetria) chamado a cada troca de
// aba do DmaicReportModal sem nenhum debounce no cliente -- sem cache aqui, rajadas de cliques
// disparavam a mesma consulta ao Supabase repetidas vezes por minuto, e como os dados de base
// mudam pouco, a maior parte batia no cache interno do Supabase e estourou a cota gratuita de
// "Cached Egress" da organização (~8,3GB/5GB no ciclo de 09/08-09/09/2026). Cache em memória por
// instância, chaveado por scope+segment, no mesmo padrão do /api/dashboard/overview.
const reportCache=new Map<string,{expiresAt:number;payload:unknown}>();
const REPORT_CACHE_TTL_MS=120_000;
const total=(values:number[])=>values.reduce((a,b)=>a+b,0);
const average=(values:number[])=>values.length?total(values)/values.length:null;
const median=(values:number[])=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
function completionStats(rows:Array<{delta:number;progressPct:number|null;abandoned:boolean}>,threshold:number){const severe=rows.filter(row=>row.delta<-threshold&&row.progressPct!==null),completion=severe.map(row=>row.progressPct as number),early=severe.filter(row=>(row.progressPct??100)<=25),abandoned=severe.filter(row=>row.abandoned);return{sample:severe.length,averagePct:average(completion)===null?null:Number(average(completion)!.toFixed(1)),medianPct:median(completion)===null?null:Number(median(completion)!.toFixed(1)),earlyCount:early.length,earlyRate:severe.length?Number((early.length/severe.length*100).toFixed(1)):null,abandonedCount:abandoned.length,abandonedRate:severe.length?Number((abandoned.length/severe.length*100).toFixed(1)):null}}
function fail(source:string,error:unknown):never{const value=error&&typeof error==="object"?error as Record<string,unknown>:{};throw new Error(source+": "+(typeof value.message==="string"?value.message:String(error)))}
async function racesFor(driverId:string,start:string,end:string){const all:RaceInput[]=[];for(let from=0;;from+=1000){const{data,error}=await supabaseAdmin.from("v_race_results_irating").select("raced_at,category,series_name,track_name,car_name,season_week,finish_position,grid_position,position_change,irating_after,irating_before,sof,incidents,laps,fastest_lap_time").eq("driver_id",driverId).gte("raced_at",start).lt("raced_at",end).in("category",CATEGORIES).order("raced_at",{ascending:true}).range(from,from+999);if(error)fail("v_race_results_irating",error);all.push(...((data??[])as RaceInput[]));if(!data||data.length<1000)return all}}

export async function GET(request:NextRequest){
 try{
  const scope=request.nextUrl.searchParams.get("scope")==="week"?"week":"season",requestedSegment=request.nextUrl.searchParams.get("segment"),segments=SEGMENTS.filter(segment=>segment.id===(requestedSegment??"formula"));
  const cacheKey=scope+"|"+(requestedSegment??"formula"),cached=reportCache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now())return NextResponse.json(cached.payload,{headers:{"Cache-Control":"private, max-age=120, stale-while-revalidate=300"}});
  const{data:driver,error:driverError}=await supabaseAdmin.from("drivers").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();if(driverError)fail("drivers",driverError);if(!driver)throw new Error("Nenhum piloto encontrado no Supabase.");
  const{data:summary,error:summaryError}=await supabaseAdmin.from("v_season_summary").select("season_id,season_name");if(summaryError)fail("v_season_summary",summaryError);const seasons=[...(summary??[])].sort((a,b)=>Number(b.season_id)-Number(a.season_id)),current=seasons[0],previous=seasons[1];if(!current||!previous)throw new Error("São necessárias duas seasons para comparar.");
  const{data:calendar,error:calendarError}=await supabaseAdmin.from("v_season_calendar").select("season_id,season_start").in("season_id",[String(current.season_id),String(previous.season_id)]);if(calendarError)fail("v_season_calendar",calendarError);const byId=new Map((calendar??[]).map(x=>[String(x.season_id),x])),currentStart=byId.get(String(current.season_id))?.season_start,previousStart=byId.get(String(previous.season_id))?.season_start;if(!currentStart||!previousStart)throw new Error("Calendário sem início das seasons.");
  const rows=await racesFor(driver.id,previousStart,new Date(new Date(currentStart).getTime()+84*86400000).toISOString()),currentRows=rows.filter(x=>new Date(x.raced_at)>=new Date(currentStart)),previousRows=rows.filter(x=>new Date(x.raced_at)<new Date(currentStart));
  const sections=await Promise.all((segments.length?segments:[SEGMENTS[0]]).map(async segment=>{
   const now=currentRows.filter(row=>row.category===segment.category&&segment.match(row)),before=previousRows.filter(row=>row.category===segment.category&&segment.match(row)),latestWeek=now.reduce<number|null>((latest,row)=>row.season_week!==null&&(latest===null||row.season_week>latest)?row.season_week:latest,null),selected=scope==="week"&&latestWeek!==null?now.filter(row=>row.season_week===latestWeek):now,baseline=scope==="week"&&latestWeek!==null?now.filter(row=>row.season_week!==latestWeek):before,segmentLabel=scope==="week"&&segment.id==="formula"?"Super Formula":segment.label;
   const[survival,survivalReference,inputs,inputReference]=await Promise.all([retirementEvents(driver.id,selected,current.season_name),retirementEvents(driver.id,baseline,scope==="week"?current.season_name:previous.season_name),telemetryInputProfile(driver.id,segment.category,selected,current.season_name,scope==="week"?latestWeek:null),telemetryInputProfile(driver.id,segment.category,baseline,scope==="week"?current.season_name:previous.season_name,null)]);
   const base=buildEngineerSection(segment.category,selected,baseline,scope,scope==="week"?latestWeek:null,segmentLabel,segment.id),weekAverage=baseline.length?total(baseline.map(row=>row.irating_after-row.irating_before))/baseline.length:null,severeCompletion={current:completionStats(survival.raceProgress,base.severity.threshold),reference:completionStats(survivalReference.raceProgress,base.severity.threshold)};
   return{...base,comparison:scope==="week"?"Referência: média das outras weeks desta mesma season = "+(weekAverage===null?"—":String(weekAverage>0?"+":"")+weekAverage.toFixed(1)+" de iRating por corrida")+" em "+String(baseline.length)+" corridas.":base.comparison,retirements:survival.events,retirementReference:survivalReference.events,retirementComparison:{currentCount:survival.events.length,referenceCount:survivalReference.events.length,currentRate:selected.length?Number((survival.events.length/selected.length*100).toFixed(1)):null,referenceRate:baseline.length?Number((survivalReference.events.length/baseline.length*100).toFixed(1)):null},severeCompletion,telemetryInputs:inputs,telemetryInputReference:inputReference,seasonComparison:scope==="season"?compareSeasons(now,before):null};
  }));
  const payload={status:"ok",scope,seasonName:current.season_name,previousSeasonName:previous.season_name,generatedAt:new Date().toISOString(),methodology:"Season compara a anterior; week compara com as demais weeks da season. O diagnóstico prioriza perdas severas, sequências, retiradas, tempo em pista e relação entre consistência dos inputs e tempo de volta.",sections};
  reportCache.set(cacheKey,{expiresAt:Date.now()+REPORT_CACHE_TTL_MS,payload});
  return NextResponse.json(payload,{headers:{"Cache-Control":"private, max-age=120, stale-while-revalidate=300"}});
 }catch(error){return NextResponse.json({status:"error",message:error instanceof Error?error.message:String(error)},{status:500})}
}
