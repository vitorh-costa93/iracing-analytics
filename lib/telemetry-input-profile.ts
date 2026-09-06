import { gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";

type Payload={season?:{name?:string};sessionType?:number;startTime?:string};
type Lap={id:string;car_id:number;lap_time:number|null;clean:boolean|null;off_track:boolean|null;incomplete:boolean|null;discontinuity:boolean|null;telemetry_path:string|null;garage61_payload?:Payload};
type LapSample={lapTime:number;throttleSmoothness:number|null;brakeSmoothness:number|null;steeringSmoothness:number|null};
const norm=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,"");
const avg=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const sd=(v:number[])=>{const m=avg(v);return m===null?null:Math.sqrt(avg(v.map(x=>(x-m)**2))??0)};
const round=(v:number|null,d=2)=>v===null?null:Number(v.toFixed(d));
const index=(headers:string[],names:string[])=>headers.findIndex(h=>names.some(n=>h.includes(n)));
function values(lines:string[],column:number){if(column<0)return[];const step=Math.max(1,Math.ceil(lines.length/15000)),out:number[]=[];for(let i=1;i<lines.length;i+=step){const value=Number(lines[i].split(",")[column]);if(Number.isFinite(value))out.push(value)}return out}
const smoothness=(v:number[])=>v.length<2?null:avg(v.slice(1).map((x,i)=>Math.abs(x-v[i])));
function correlation(a:number[],b:number[]){if(a.length<5||a.length!==b.length)return null;const am=avg(a)!,bm=avg(b)!,num=sum(a.map((x,i)=>(x-am)*(b[i]-bm))),den=Math.sqrt(sum(a.map(x=>(x-am)**2))*sum(b.map(x=>(x-bm)**2)));return den?num/den:null}
const sum=(v:number[])=>v.reduce((a,b)=>a+b,0);
const metric=(samples:LapSample[],key:"throttleSmoothness"|"brakeSmoothness"|"steeringSmoothness")=>samples.filter(s=>s[key]!==null).map(s=>({lap:s.lapTime,input:s[key] as number}));
const repeatability=(pairs:{lap:number;input:number}[])=>{const inputs=pairs.map(x=>x.input),mean=avg(inputs);return mean&&mean!==0?round((sd(inputs)!/Math.abs(mean))*100,1):null};
const correlate=(pairs:{lap:number;input:number}[])=>round(correlation(pairs.map(x=>x.input),pairs.map(x=>x.lap)),2);

export async function telemetryInputProfile(driverId:string,category:Category,races:RaceInput[],seasonName:string,week:number|null){
 const names=new Set(races.map(r=>norm(r.car_name)));if(!names.size)return empty("Sem corridas no recorte.");
 const {data:cars,error:ce}=await supabaseAdmin.from("cars").select("id,name");if(ce)throw ce;const ids=(cars??[]).filter(c=>names.has(norm(c.name??""))).map(c=>c.id);if(!ids.length)return empty("Carros do recorte não encontrados.");
 const {data,error}=await supabaseAdmin.from("laps").select("id,car_id,lap_time,clean,off_track,incomplete,discontinuity,telemetry_path,garage61_payload").eq("driver_id",driverId).in("car_id",ids).contains("garage61_payload",{season:{name:seasonName}}).not("telemetry_path","is",null).order("synced_at",{ascending:false}).limit(400);if(error)throw error;
 const raceTimes=races.map(r=>new Date(r.raced_at).getTime()).filter(Number.isFinite);
 const candidates=((data??[]) as Lap[]).filter(l=>{const p=l.garage61_payload??{},time=p.startTime?new Date(p.startTime).getTime():NaN;return(p.sessionType===2||p.sessionType===3)&&l.clean===true&&l.off_track!==true&&l.incomplete!==true&&l.discontinuity!==true&&typeof l.lap_time==="number"&&l.lap_time>0&&Number.isFinite(time)&&raceTimes.some(race=>Math.abs(time-race)<=3*3600000)}).slice(0,18);
 const samples:LapSample[]=[];
 for(const lap of candidates){if(!lap.telemetry_path)continue;const d=await supabaseAdmin.storage.from("telemetry").download(lap.telemetry_path);if(d.error||!d.data)continue;let raw=Buffer.from(await d.data.arrayBuffer());try{if(lap.telemetry_path.endsWith(".gz"))raw=gunzipSync(raw)}catch{continue}const lines=raw.toString("utf8").split(/\r?\n/);if(lines.length<3)continue;const headers=lines[0].split(",").map(norm),throttle=values(lines,index(headers,["throttle"])),brake=values(lines,index(headers,["brake"])),steering=values(lines,index(headers,["steeringwheelangle","steering"]));const ts=Math.max(...throttle.map(Math.abs),0)>1.5?100:1,bs=Math.max(...brake.map(Math.abs),0)>1.5?100:1;samples.push({lapTime:lap.lap_time!,throttleSmoothness:smoothness(throttle.map(x=>x/ts)),brakeSmoothness:smoothness(brake.map(x=>x/bs)),steeringSmoothness:smoothness(steering)})}
 const lapTimes=samples.map(s=>s.lapTime),best=lapTimes.length?Math.min(...lapTimes):null,mean=avg(lapTimes),lapStd=sd(lapTimes),throttle=metric(samples,"throttleSmoothness"),brake=metric(samples,"brakeSmoothness"),steering=metric(samples,"steeringSmoothness");
 return{files:samples.length,laps:samples.length,coverage:week!==null?"voltas limpas de corrida da week":"voltas limpas de corrida da season",meanLapSeconds:round(mean,3),bestLapSeconds:round(best,3),averageGapToBestSeconds:mean!==null&&best!==null?round(mean-best,3):null,lapStdDevSeconds:round(lapStd,3),lapCvPct:mean&&lapStd!==null?round(lapStd/mean*100,2):null,throttleRepeatabilityPct:repeatability(throttle),brakeRepeatabilityPct:repeatability(brake),steeringRepeatabilityPct:repeatability(steering),throttleLapCorrelation:correlate(throttle),brakeLapCorrelation:correlate(brake),steeringLapCorrelation:correlate(steering),note:samples.length>=8?"Correlação positiva indica que maior variação do input apareceu junto de voltas mais lentas; próxima de zero indica pouca relação observável.":"Amostra pequena: use os valores como sinal, não como conclusão."};
}
function empty(note:string){return{files:0,laps:0,coverage:"sem cobertura",meanLapSeconds:null,bestLapSeconds:null,averageGapToBestSeconds:null,lapStdDevSeconds:null,lapCvPct:null,throttleRepeatabilityPct:null,brakeRepeatabilityPct:null,steeringRepeatabilityPct:null,throttleLapCorrelation:null,brakeLapCorrelation:null,steeringLapCorrelation:null,note}}
