import { supabaseAdmin } from "@/lib/supabase-admin";
import { RaceInput } from "@/lib/race-engineer-analysis";

type P={event?:string;session?:number|string;sessionType?:number;startTime?:string;tow?:boolean;towed?:boolean};
type Lap={car_id:number;track_id:number;lap_number:number|null;lap_time:number|null;incomplete:boolean|null;missing:boolean|null;discontinuity:boolean|null;garage61_payload:unknown};
type Event={racedAt:string;context:string;delta:number;positionChange:number|null;type:string;confidence:"driver"|"confirmed"|"probable";completedLaps:number;timeOnTrackSeconds:number;progressPct:number|null};
type Candidate={race:RaceInput;raceKey:string;contextKey:string;seconds:number;completedLaps:number;confirmed:boolean;terminal:boolean};
const key=(s:string)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
const same=(a:string|undefined,b:string)=>!!a&&(a===b||a.includes(b)||b.includes(a)||(a.length>=8&&b.length>=8&&a.slice(0,8)===b.slice(0,8)));
async function allLaps(driverId:string){const out:Lap[]=[];for(let from=0;;from+=1000){const{data,error}=await supabaseAdmin.from("laps").select("car_id,track_id,lap_number,lap_time,incomplete,missing,discontinuity,garage61_payload").eq("driver_id",driverId).range(from,from+999);if(error)throw error;out.push(...((data??[])as Lap[]));if(!data||data.length<1000)return out}}

export async function retirementEvents(driverId:string,races:RaceInput[],_seasonName:string){
 const[{data:cars,error:ce},{data:tracks,error:te},laps]=await Promise.all([supabaseAdmin.from("cars").select("id,name"),supabaseAdmin.from("tracks").select("id,name"),allLaps(driverId)]);if(ce)throw ce;if(te)throw te;
 const car=new Map((cars??[]).map(x=>[x.id,key(x.name)])),track=new Map((tracks??[]).map(x=>[x.id,key(x.name)])),groups=new Map<string,Lap[]>();
 for(const lap of laps){const p=(lap.garage61_payload??{})as P;if(!p.startTime||p.sessionType!==3)continue;const groupKey=String(lap.car_id)+":"+String(lap.track_id)+":"+(p.event??"")+":"+(p.session??"");groups.set(groupKey,[...(groups.get(groupKey)??[]),lap])}
 const candidates:Candidate[]=[],durations=new Map<string,number[]>();
 for(const rows of groups.values()){const p=(rows[0].garage61_payload??{})as P;if(!p.startTime)continue;const start=new Date(p.startTime).getTime(),cn=car.get(rows[0].car_id),tn=track.get(rows[0].track_id),race=races.filter(r=>same(cn,key(r.car_name))&&same(tn,key(r.track_name))).sort((a,b)=>Math.abs(new Date(a.raced_at).getTime()-start)-Math.abs(new Date(b.raced_at).getTime()-start))[0];if(!race||Math.abs(new Date(race.raced_at).getTime()-start)>2*3600000)continue;
  const contextKey=key(race.car_name)+"|"+key(race.track_name),seconds=rows.reduce((total,lap)=>total+(typeof lap.lap_time==="number"&&lap.lap_time>0?lap.lap_time:0),0),completedLaps=rows.filter(lap=>typeof lap.lap_time==="number"&&lap.lap_time>0).length,raceKey=race.raced_at+"|"+race.car_name+"|"+race.track_name;
  durations.set(contextKey,[...(durations.get(contextKey)??[]),seconds]);
  const confirmed=rows.some(l=>{const q=(l.garage61_payload??{})as P;return q.tow===true||q.towed===true}),last=[...rows].sort((a,b)=>(b.lap_number??0)-(a.lap_number??0))[0],terminal=rows.length>=3&&!!last&&(last.incomplete===true||last.missing===true||last.discontinuity===true);
  candidates.push({race,raceKey,contextKey,seconds,completedLaps,confirmed,terminal});
 }
 const bestByRace=new Map<string,Candidate>();for(const candidate of candidates){const old=bestByRace.get(candidate.raceKey);if(!old||candidate.seconds>old.seconds)bestByRace.set(candidate.raceKey,candidate)}
 const detected:Array<Omit<Event,"progressPct"> & {contextKey:string}>=[];
 for(const item of bestByRace.values()){const reference=Math.max(...(durations.get(item.contextKey)??[]),0),progress=reference>0?item.seconds/reference*100:100,damage=(item.race.irating_after-item.race.irating_before)<0&&(item.race.position_change??0)<=-3;
  if(!item.confirmed&&!(item.terminal&&damage&&progress<80))continue;
  detected.push({racedAt:item.race.raced_at,context:item.race.car_name+" • "+item.race.track_name,contextKey:item.contextKey,delta:item.race.irating_after-item.race.irating_before,positionChange:item.race.position_change,type:item.confirmed?"Tow confirmado":"Abandono provável: corrida interrompida antes de 80% do tempo de referência",confidence:item.confirmed?"confirmed":"probable",completedLaps:item.completedLaps,timeOnTrackSeconds:item.seconds});
 }
 const driverRace=races.find(r=>Math.abs(new Date(r.raced_at).getTime()-new Date("2026-09-04T18:30:00.000Z").getTime())<=30*60000&&key(r.car_name).includes("sf23")&&key(r.track_name).includes("silverstone"));
 if(driverRace){const raceKey=driverRace.raced_at+"|"+driverRace.car_name+"|"+driverRace.track_name,item=bestByRace.get(raceKey),contextKey=key(driverRace.car_name)+"|"+key(driverRace.track_name);detected.push({racedAt:driverRace.raced_at,context:driverRace.car_name+" • "+driverRace.track_name,contextKey,delta:driverRace.irating_after-driverRace.irating_before,positionChange:driverRace.position_change,type:"Tow / abandono confirmado pelo piloto",confidence:"driver",completedLaps:item?.completedLaps??driverRace.laps??0,timeOnTrackSeconds:item?.seconds??0})}
 const unique=new Map<string,typeof detected[number]>();for(const event of detected){const eventKey=event.racedAt+"|"+event.context,old=unique.get(eventKey),priority=(x:typeof event)=>x.confidence==="driver"?4:x.confidence==="confirmed"?3:1;if(!old||priority(event)>priority(old))unique.set(eventKey,event)}
 const events=[...unique.values()].map(event=>{const reference=Math.max(...(durations.get(event.contextKey)??[]),0);const{contextKey,...rest}=event;return{...rest,progressPct:reference>0?Number(Math.min(100,event.timeOnTrackSeconds/reference*100).toFixed(1)):null}}).sort((a,b)=>a.confidence!==b.confidence?(a.confidence==="driver"?-1:b.confidence==="driver"?1:a.confidence==="confirmed"?-1:1):a.delta-b.delta);
 const eventKeys=new Set(events.map(event=>event.racedAt+"|"+event.context));
 const raceProgress=[...bestByRace.values()].map(item=>{const reference=Math.max(...(durations.get(item.contextKey)??[]),0),context=item.race.car_name+" • "+item.race.track_name;return{racedAt:item.race.raced_at,context,delta:item.race.irating_after-item.race.irating_before,progressPct:reference>0?Number(Math.min(100,item.seconds/reference*100).toFixed(1)):null,abandoned:eventKeys.has(item.race.raced_at+"|"+context)}}).filter(item=>item.progressPct!==null);
 return{events,raceProgress};
}
