import { gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";

type Payload={season?:{name?:string};seasonWeek?:number;week?:number;sessionType?:number};
type Lap={car_id:number;telemetry_path:string|null;garage61_payload?:Payload};
const norm=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,"");
const avg=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const round=(v:number|null,d=2)=>v===null?null:Number(v.toFixed(d));
const variation=(v:number[])=>{const m=avg(v);return m===null?null:Math.sqrt(avg(v.map(x=>(x-m)**2))??0)};
const headerIndex=(headers:string[],names:string[])=>headers.findIndex(h=>names.some(n=>h.includes(n)));
function numbers(lines:string[],index:number){if(index<0)return[];const step=Math.max(1,Math.ceil(lines.length/12000));const out:number[]=[];for(let i=1;i<lines.length;i+=step){const value=Number(lines[i].split(",")[index]);if(Number.isFinite(value))out.push(value)}return out}
function changes(values:number[]){if(values.length<2)return null;return avg(values.slice(1).map((v,i)=>Math.abs(v-values[i])))}
export async function telemetryInputProfile(driverId:string,category:Category,races:RaceInput[],seasonName:string,week:number|null){
 const names=new Set(races.map(r=>norm(r.car_name)));if(!names.size)return{files:0,samples:0,coverage:"sem amostra",throttleStability:null,brakeStability:null,steeringStability:null,fullThrottlePct:null,hardBrakePct:null,note:"Sem telemetria associável ao recorte."};
 const {data:cars,error:ce}=await supabaseAdmin.from("cars").select("id,name");if(ce)throw ce;const ids=new Set((cars??[]).filter(c=>names.has(norm(c.name??""))).map(c=>c.id));
 const {data,error}=await supabaseAdmin.from("laps").select("car_id,telemetry_path,garage61_payload").eq("driver_id",driverId).not("telemetry_path","is",null).limit(800);if(error)throw error;
 let candidates=((data??[]) as Lap[]).filter(l=>ids.has(l.car_id)&&l.garage61_payload?.season?.name===seasonName);
 if(week!==null){const exact=candidates.filter(l=>(l.garage61_payload?.seasonWeek??l.garage61_payload?.week)===week);if(exact.length)candidates=exact}
 candidates=candidates.slice(-6);
 const throttle:number[]=[],brake:number[]=[],steering:number[]=[];let files=0;
 for(const lap of candidates){if(!lap.telemetry_path)continue;const d=await supabaseAdmin.storage.from("telemetry").download(lap.telemetry_path);if(d.error||!d.data)continue;let raw=Buffer.from(await d.data.arrayBuffer());try{if(lap.telemetry_path.endsWith(".gz"))raw=gunzipSync(raw)}catch{continue}const lines=raw.toString("utf8").split(/\r?\n/);if(lines.length<3)continue;const headers=lines[0].split(",").map(norm);const ti=headerIndex(headers,["throttle"]);const bi=headerIndex(headers,["brake"]);const si=headerIndex(headers,["steeringwheelangle","steering"]);const t=numbers(lines,ti),b=numbers(lines,bi),s=numbers(lines,si);if(!t.length&&!b.length&&!s.length)continue;throttle.push(...t);brake.push(...b);steering.push(...s);files++}
 const scale=(v:number[])=>Math.max(...v.map(Math.abs),0)>1.5?100:1;const ts=scale(throttle),bs=scale(brake);
 return{files,samples:Math.max(throttle.length,brake.length,steering.length),coverage:week!==null?"week quando identificada no payload; caso contrário season":"season",throttleStability:round(changes(throttle.map(x=>x/ts))),brakeStability:round(changes(brake.map(x=>x/bs))),steeringStability:round(changes(steering)),fullThrottlePct:round(throttle.length?throttle.filter(x=>x/ts>=.9).length/throttle.length*100:null,1),hardBrakePct:round(brake.length?brake.filter(x=>x/bs>=.6).length/brake.length*100:null,1),steeringVariation:round(variation(steering)),note:files?"Variação menor entre amostras indica inputs mais progressivos; percentuais mostram tempo relativo em aplicação forte.":"Os CSVs encontrados não expuseram canais reconhecíveis de freio, acelerador e volante."};
}
