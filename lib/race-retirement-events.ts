import { supabaseAdmin } from "@/lib/supabase-admin";
import { RaceInput } from "@/lib/race-engineer-analysis";

type P={event?:string;session?:number|string;sessionType?:number;startTime?:string;tow?:boolean;towed?:boolean};
type Lap={car_id:number;track_id:number;lap_number:number|null;incomplete:boolean|null;missing:boolean|null;discontinuity:boolean|null;pit_in:boolean|null;pit_out:boolean|null;garage61_payload:unknown};
const key=(s:string)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
const same=(a:string|undefined,b:string)=>!!a&&(a===b||a.includes(b)||b.includes(a)||(a.length>=8&&b.length>=8&&a.slice(0,8)===b.slice(0,8)));

async function allLaps(driverId:string){
 const out:Lap[]=[];
 for(let from=0;;from+=1000){
  const {data,error}=await supabaseAdmin.from("laps").select("car_id,track_id,lap_number,incomplete,missing,discontinuity,pit_in,pit_out,garage61_payload").eq("driver_id",driverId).range(from,from+999);
  if(error)throw error;out.push(...((data??[]) as Lap[]));if(!data||data.length<1000)return out;
 }
}

export async function retirementEvents(driverId:string,races:RaceInput[],seasonName:string){
 const [{data:cars,error:ce},{data:tracks,error:te},laps]=await Promise.all([
  supabaseAdmin.from("cars").select("id,name"),
  supabaseAdmin.from("tracks").select("id,name"),
  allLaps(driverId),
 ]);
 if(ce)throw ce;if(te)throw te;
 const car=new Map((cars??[]).map(x=>[x.id,key(x.name)])),track=new Map((tracks??[]).map(x=>[x.id,key(x.name)]));
 const groups=new Map<string,Lap[]>();
 for(const lap of laps){const p=(lap.garage61_payload??{}) as P;if(!p.startTime||!(p.sessionType===2||p.sessionType===3))continue;const groupKey=String(lap.car_id)+":"+String(lap.track_id)+":"+(p.event??"")+":"+(p.session??"");groups.set(groupKey,[...(groups.get(groupKey)??[]),lap])}
 const events=[] as {racedAt:string;context:string;delta:number;positionChange:number|null;incidents:number|null;type:string;confidence:"confirmed"|"probable";laps:number}[];
 for(const rows of groups.values()){
  const p=(rows[0].garage61_payload??{}) as P;if(!p.startTime)continue;const start=new Date(p.startTime).getTime(),cn=car.get(rows[0].car_id),tn=track.get(rows[0].track_id);
  const race=races.filter(r=>same(cn,key(r.car_name))&&same(tn,key(r.track_name))).sort((a,b)=>Math.abs(new Date(a.raced_at).getTime()-start)-Math.abs(new Date(b.raced_at).getTime()-start))[0];
  if(!race||Math.abs(new Date(race.raced_at).getTime()-start)>2*3600000)continue;
  const confirmed=rows.some(l=>{const q=(l.garage61_payload??{}) as P;return q.tow===true||q.towed===true});
  const interrupted=rows.some(l=>(l.incomplete===true||l.missing===true||l.discontinuity===true)&&(l.pit_in===true||l.pit_out===true));
  const last=[...rows].sort((a,b)=>(b.lap_number??0)-(a.lap_number??0))[0];
  const terminal=rows.length>=3&&!!last&&(last.incomplete===true||last.missing===true||last.discontinuity===true);
  const damagingFinish=(race.irating_after-race.irating_before)<0&&(race.position_change??0)<=-3;
  if(!confirmed&&!interrupted&&!(terminal&&damagingFinish))continue;
  events.push({racedAt:race.raced_at,context:race.car_name+" • "+race.track_name,delta:race.irating_after-race.irating_before,positionChange:race.position_change,incidents:race.incidents,type:confirmed?"Tow confirmado":interrupted?"Retirada provável (pit + volta interrompida)":"Retirada provável (volta final interrompida + resultado danoso)",confidence:confirmed?"confirmed":"probable",laps:rows.length});
 }
 return events.sort((a,b)=>a.delta-b.delta).slice(0,8);
}
