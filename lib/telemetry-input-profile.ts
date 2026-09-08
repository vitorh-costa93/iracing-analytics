import { gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";
import { telemetryFeatures } from "@/lib/telemetry-features";
import { cornerBrakePoints, CornerBrakePoint } from "@/lib/telemetry-corner-brakes";

type Payload={season?:{name?:string};sessionType?:number;session_type?:number;session?:string|number;startTime?:string};
type Lap={id:string;car_id:number;track_id:number;lap_time:number|null;clean:boolean|null;off_track:boolean|null;incomplete:boolean|null;discontinuity:boolean|null;telemetry_path:string|null;garage61_payload?:Payload};
type LapSample={lapTime:number;session:string;gap:number;throttleSmoothness:number|null;brakeSmoothness:number|null;steeringSmoothness:number|null;cornerBrakes:CornerBrakePoint[]|null};
type CachedFeatureRow={lap_id:string;throttle_smoothness:number|null;brake_smoothness:number|null;steering_smoothness:number|null;corner_brakes:CornerBrakePoint[]|null;parser_version:string};
export type ContextCorner={context:string;corner:number;peakDistancePct:number;avgBrakePointPct:number|null;lapsWithBrake:number;lapsFlatOut:number;sampleLaps:number};
const norm=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,"");
const avg=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const sd=(v:number[])=>{const m=avg(v);return m===null?null:Math.sqrt(avg(v.map(x=>(x-m)**2))??0)};
const round=(v:number|null,d=2)=>v===null?null:Number(v.toFixed(d));
const sum=(v:number[])=>v.reduce((a,b)=>a+b,0);
// 08/09/2026: "ative isso como cache, performance é bem importante" -- lib/telemetry-features.ts e a
// tabela telemetry_features já existiam (migração 20260905201500) mas nada os usava: cada abertura
// do Debrief baixava e reprocessava o CSV gzip de cada volta do zero. Como cada volta tem seu próprio
// arquivo imutável (lib/telemetry-backfill.ts grava um .csv.gz por lap.id, nunca reescreve), o par
// lap_id/parser_version é um cache perfeito -- calcula uma vez, nunca precisa invalidar. Bump esta
// constante junto com qualquer mudança material em telemetryFeatures()/cornerBrakePoints() pra não
// servir linhas velhas -- v2 (08/09/2026) adiciona corner_brakes, então toda linha v1 é reprocessada
// uma única vez (são só ~150 linhas hoje, custo baixo e pago uma vez só).
const PARSER_VERSION="v3";
// Curvas detectadas em voltas diferentes do mesmo carro+pista podem cair em índices ligeiramente
// diferentes (ruído de GPS). Em vez de confiar no número da curva por volta, agrupa por proximidade
// real do pico (peakDistance, em % da volta) somando as curvas de todas as voltas da mesma combinação
// -- CLUSTER_GAP_PCT é a distância máxima entre dois picos pra contar como a mesma curva.
const CLUSTER_GAP_PCT=3;
function clusterCorners(context:string,cornersByLap:Array<CornerBrakePoint[]|null>):ContextCorner[]{
 const flat=cornersByLap.filter((c):c is CornerBrakePoint[]=>c!==null).flat();
 if(!flat.length)return[];
 const sorted=[...flat].sort((a,b)=>a.peakDistance-b.peakDistance);
 const clusters:CornerBrakePoint[][]=[[sorted[0]]];
 for(let i=1;i<sorted.length;i++){
  const last=clusters[clusters.length-1];
  if(sorted[i].peakDistance-last[last.length-1].peakDistance<=CLUSTER_GAP_PCT)last.push(sorted[i]);
  else clusters.push([sorted[i]]);
 }
 if(clusters.length>1){
  const first=clusters[0],last=clusters[clusters.length-1];
  if(first[0].peakDistance<=CLUSTER_GAP_PCT&&100-last[last.length-1].peakDistance<=CLUSTER_GAP_PCT){clusters[0]=[...last,...first];clusters.pop()}
 }
 return clusters.map((points,index)=>{
  const withBrake=points.filter(p=>p.brakePointPct!==null);
  return{context,corner:index+1,peakDistancePct:round(avg(points.map(p=>p.peakDistance)),1)??points[0].peakDistance,avgBrakePointPct:withBrake.length?round(avg(withBrake.map(p=>p.brakePointPct as number)),1):null,lapsWithBrake:withBrake.length,lapsFlatOut:points.length-withBrake.length,sampleLaps:points.length};
 });
}
function correlation(a:number[],b:number[]){if(a.length<5||a.length!==b.length)return null;const am=avg(a)!,bm=avg(b)!,num=sum(a.map((x,i)=>(x-am)*(b[i]-bm))),den=Math.sqrt(sum(a.map(x=>(x-am)**2))*sum(b.map(x=>(x-bm)**2)));return den?num/den:null}
const metric=(samples:LapSample[],key:"throttleSmoothness"|"brakeSmoothness"|"steeringSmoothness")=>samples.filter(s=>s[key]!==null).map(s=>({lap:s.gap,input:s[key] as number}));
const repeatability=(pairs:{lap:number;input:number}[])=>{const inputs=pairs.map(x=>x.input),mean=avg(inputs);return mean&&mean!==0?round((sd(inputs)!/Math.abs(mean))*100,1):null};
const correlate=(pairs:{lap:number;input:number}[])=>round(correlation(pairs.map(x=>x.input),pairs.map(x=>x.lap)),2);
const isRace=(payload:Payload)=>payload.session==="Race"||payload.sessionType===2||payload.sessionType===3||payload.session_type===2||payload.session_type===3;
const PAGE=500;
const RACE_MATCH_WINDOW_MS=6*3600000;

export async function telemetryInputProfile(driverId:string,category:Category,races:RaceInput[],seasonName:string,week:number|null){
 const names=new Set(races.map(r=>norm(r.car_name)));if(!names.size)return empty("Sem corridas no recorte.");
 const [{data:cars,error:ce},{data:tracks,error:tre}]=await Promise.all([supabaseAdmin.from("cars").select("id,name"),supabaseAdmin.from("tracks").select("id,name")]);if(ce)throw ce;if(tre)throw tre;
 const carName=new Map((cars??[]).map(c=>[c.id,c.name as string])),trackName=new Map((tracks??[]).map(t=>[t.id,t.name as string]));
 const ids=(cars??[]).filter(c=>names.has(norm(c.name??""))).map(c=>c.id);if(!ids.length)return empty("Carros do recorte não encontrados.");
 const all:Lap[]=[];for(let from=0;;from+=PAGE){const {data,error}=await supabaseAdmin.from("laps").select("id,car_id,track_id,lap_time,clean,off_track,incomplete,discontinuity,telemetry_path,garage61_payload").eq("driver_id",driverId).in("car_id",ids).contains("garage61_payload",{season:{name:seasonName}}).not("telemetry_path","is",null).order("id",{ascending:true}).range(from,from+PAGE-1);if(error)throw error;all.push(...((data??[])as Lap[]));if(!data||data.length<PAGE)break}
 const raceTimes=races.map(r=>new Date(r.raced_at).getTime()).filter(Number.isFinite);
 const eligible=all.filter(l=>{const p=l.garage61_payload??{},time=p.startTime?new Date(p.startTime).getTime():NaN;return isRace(p)&&l.clean!==false&&l.off_track!==true&&l.incomplete!==true&&l.discontinuity!==true&&typeof l.lap_time==="number"&&l.lap_time>0&&Number.isFinite(time)&&raceTimes.some(race=>Math.abs(time-race)<=RACE_MATCH_WINDOW_MS)}),groups=new Map<string,Lap[]>();for(const lap of eligible){const group=String(lap.car_id)+"|"+String(lap.track_id);groups.set(group,[...(groups.get(group)??[]),lap])}
 // 08/09/2026: o cap antigo (2 combinações carro+pista x 5 voltas = 10 no máximo) descartava a maior
 // parte da telemetria já sincronizada -- só Super Formula em Algarve+Silverstone tinha 41 voltas
 // limpas disponíveis nesta season e a análise usava 10. Sobe pra até 3 combinações x 10 voltas (30
 // no total); ainda bem abaixo do maxDuration=300s da rota, mas triplica a amostra real usada nas
 // correlações de input sem mudar o método (mesmo carro+pista, só voltas limpas de corrida).
 const GROUP_CAP=3,LAPS_PER_GROUP=10,TOTAL_CAP=30;
 const candidates=[...groups.values()].filter(rows=>rows.length>=2).sort((a,b)=>b.length-a.length).slice(0,GROUP_CAP).flatMap(rows=>rows.slice(0,LAPS_PER_GROUP)).slice(0,TOTAL_CAP);
 const cached=new Map<string,CachedFeatureRow>();
 for(let from=0;from<candidates.length;from+=500){
  const ids=candidates.slice(from,from+500).map(lap=>lap.id);
  const{data,error}=await supabaseAdmin.from("telemetry_features").select("lap_id,throttle_smoothness,brake_smoothness,steering_smoothness,corner_brakes,parser_version").in("lap_id",ids);
  if(error)throw error;
  for(const row of(data??[])as CachedFeatureRow[])if(row.parser_version===PARSER_VERSION)cached.set(row.lap_id,row);
 }
 const decode=async(lap:Lap):Promise<Omit<LapSample,"gap">|null>=>{
  const hit=cached.get(lap.id);
  if(hit)return{lapTime:lap.lap_time!,session:String(lap.car_id)+"|"+String(lap.track_id),throttleSmoothness:hit.throttle_smoothness,brakeSmoothness:hit.brake_smoothness,steeringSmoothness:hit.steering_smoothness,cornerBrakes:hit.corner_brakes};
  if(!lap.telemetry_path)return null;
  const d=await supabaseAdmin.storage.from("telemetry").download(lap.telemetry_path);if(d.error||!d.data)return null;
  let raw=Buffer.from(await d.data.arrayBuffer());try{if(lap.telemetry_path.endsWith(".gz"))raw=gunzipSync(raw)}catch{return null}
  const csv=raw.toString("utf8");if(csv.split(/\r?\n/).length<3)return null;
  const features=telemetryFeatures(csv),corners=cornerBrakePoints(csv);
  // Write-through: grava o resultado assim que calculado (aguardado, não fire-and-forget -- numa
  // função serverless o processo pode ser encerrado antes de uma promise solta terminar) pra nunca
  // mais precisar baixar/descompactar/parsear este lap_id de novo.
  const upsert=await supabaseAdmin.from("telemetry_features").upsert({lap_id:lap.id,samples:features.samples,throttle_mean:features.throttle_mean,throttle_stddev:features.throttle_stddev,brake_mean:features.brake_mean,brake_stddev:features.brake_stddev,steering_mean:features.steering_mean,steering_stddev:features.steering_stddev,throttle_smoothness:features.throttle_smoothness,brake_smoothness:features.brake_smoothness,steering_smoothness:features.steering_smoothness,speed_mean:features.speed_mean,available_columns:features.available_columns,corner_brakes:corners,parser_version:PARSER_VERSION},{onConflict:"lap_id"});
  if(upsert.error)console.error("telemetry_features upsert failed for lap "+lap.id+": "+upsert.error.message);
  return{lapTime:lap.lap_time!,session:String(lap.car_id)+"|"+String(lap.track_id),throttleSmoothness:features.throttle_smoothness,brakeSmoothness:features.brake_smoothness,steeringSmoothness:features.steering_smoothness,cornerBrakes:corners};
 };
 const rawSamples:Array<Omit<LapSample,"gap">>=[];for(let offset=0;offset<candidates.length;offset+=12){const batch=await Promise.all(candidates.slice(offset,offset+12).map(decode));rawSamples.push(...batch.filter((sample):sample is Omit<LapSample,"gap">=>sample!==null))}
 const counts=new Map<string,number>();for(const sample of rawSamples)counts.set(sample.session,(counts.get(sample.session)??0)+1);const comparableRaw=rawSamples.filter(sample=>(counts.get(sample.session)??0)>=2);if(!comparableRaw.length)return empty(eligible.length===0?"Nenhum CSV limpo de corrida foi encontrado para as "+String(races.length)+" corridas deste recorte. O backfill precisa carregar a telemetria dessas corridas.":"Foram encontradas "+String(eligible.length)+" voltas limpas de corrida, mas ainda não há duas do mesmo carro e pista para calcular consistência.");
 const bestBySession=new Map<string,number>();for(const sample of comparableRaw)bestBySession.set(sample.session,Math.min(bestBySession.get(sample.session)??Infinity,sample.lapTime));
 const samples:LapSample[]=comparableRaw.map(sample=>({...sample,gap:sample.lapTime-(bestBySession.get(sample.session)??sample.lapTime)})),gaps=samples.map(s=>s.gap),lapStd=sd(gaps),gapMean=avg(gaps),contexts=bestBySession.size,onlyOne=contexts===1,lapTimes=samples.map(s=>s.lapTime),throttle=metric(samples,"throttleSmoothness"),brake=metric(samples,"brakeSmoothness"),steering=metric(samples,"steeringSmoothness");
 const bySession=new Map<string,LapSample[]>();for(const sample of samples)bySession.set(sample.session,[...(bySession.get(sample.session)??[]),sample]);
 const cornerBraking=[...bySession.entries()].flatMap(([session,sessionSamples])=>{
  const[carId,trackId]=session.split("|"),context=(carName.get(Number(carId))??"Carro")+" • "+(trackName.get(Number(trackId))??"Pista");
  return clusterCorners(context,sessionSamples.map(s=>s.cornerBrakes));
 });
 return{files:samples.length,laps:samples.length,coverage:String(contexts)+" combinações carro+pista; tempos normalizados pela melhor volta limpa de cada combinação",meanLapSeconds:onlyOne?round(avg(lapTimes),3):null,bestLapSeconds:onlyOne&&lapTimes.length?round(Math.min(...lapTimes),3):null,averageGapToBestSeconds:round(gapMean,3),lapStdDevSeconds:round(lapStd,3),lapCvPct:null,throttleRepeatabilityPct:repeatability(throttle),brakeRepeatabilityPct:repeatability(brake),steeringRepeatabilityPct:repeatability(steering),throttleLapCorrelation:correlate(throttle),brakeLapCorrelation:correlate(brake),steeringLapCorrelation:correlate(steering),cornerBraking,note:samples.length>=15?"Cada volta foi comparada apenas com voltas do mesmo carro e pista. A correlação mostra se variar um input acompanhou aumento ou redução do gap.":"Amostra pequena ("+String(samples.length)+" voltas): use os valores como sinal, não como conclusão."};
}
function empty(note:string){return{files:0,laps:0,coverage:"sem cobertura",meanLapSeconds:null,bestLapSeconds:null,averageGapToBestSeconds:null,lapStdDevSeconds:null,lapCvPct:null,throttleRepeatabilityPct:null,brakeRepeatabilityPct:null,steeringRepeatabilityPct:null,throttleLapCorrelation:null,brakeLapCorrelation:null,steeringLapCorrelation:null,cornerBraking:[] as ContextCorner[],note}}
