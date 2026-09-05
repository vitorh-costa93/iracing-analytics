import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";

type Payload = { season?: { name?: string }; sessionType?: number; event?: string; session?: number|string; tow?: boolean; towed?: boolean; };
const norm = (value:string) => value.trim().toLocaleLowerCase();
const round=(v:number|null,d=1)=>v===null?null:Number(v.toFixed(d));
const average=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const stdev=(values:number[])=>{const mean=average(values);return mean===null?null:Math.sqrt(average(values.map(v=>(v-mean)**2))??0)};

export async function incidentProfile(driverId:string, category:Category, rows:RaceInput[], seasonName:string) {
 const carNames=new Set(rows.map(row=>norm(row.car_name)));
 if(!carNames.size)return {samples:0,offTrack:0,incomplete:0,discontinuity:0,pitEvent:0,towConfirmed:0,retirementSignal:0,telemetry:{sessions:0,cleanLaps:0,cleanRate:null,bestLap:null,lapConsistency:null},note:"Sem corridas suficientes para associar flags de volta."};
 const [{data:cars,error:carsError},{data:laps,error:lapsError}]=await Promise.all([
  supabaseAdmin.from("cars").select("id,name"),
  supabaseAdmin.from("laps").select("car_id,lap_time,clean,off_track,incomplete,discontinuity,missing,pit_lane,pit_in,pit_out,garage61_payload").eq("driver_id",driverId),
 ]);
 if(carsError)throw carsError;if(lapsError)throw lapsError;
 const eligibleCars=new Set((cars??[]).filter(car=>car.name&&carNames.has(norm(car.name))).map(car=>car.id));
 const items=(laps??[]).filter(lap=>{const p=(lap.garage61_payload??{}) as Payload;return eligibleCars.has(lap.car_id)&&p.season?.name===seasonName&&(p.sessionType===2||p.sessionType===3)});
 const count=(test:(lap:typeof items[number],payload:Payload)=>boolean)=>items.filter(lap=>test(lap,(lap.garage61_payload??{}) as Payload)).length;
 const offTrack=count(lap=>lap.off_track===true), incomplete=count(lap=>lap.incomplete===true||lap.missing===true), discontinuity=count(lap=>lap.discontinuity===true), pitEvent=count(lap=>lap.pit_lane===true||lap.pit_in===true||lap.pit_out===true), towConfirmed=count((_lap,p)=>p.tow===true||p.towed===true), retirementSignal=count((lap,p)=>(lap.discontinuity===true||lap.incomplete===true||lap.missing===true)&&(lap.pit_in===true||lap.pit_out===true||p.tow===true||p.towed===true));
 const sessions=new Map<string,number[]>();
 for(const lap of items){const p=(lap.garage61_payload??{}) as Payload;const time=typeof lap.lap_time==="number"?lap.lap_time:null;if(lap.clean!==true||lap.off_track===true||lap.incomplete===true||lap.discontinuity===true||time===null||time<=0)continue;const key=`${lap.car_id}:${p.event??""}:${p.session??""}`;sessions.set(key,[...(sessions.get(key)??[]),time]);}
 const usable=[...sessions.values()].filter(times=>times.length>=3);
 const variations=usable.map(times=>{const mean=average(times)!;return (stdev(times)!/mean)*100;});
 const cleanLaps=items.filter(lap=>lap.clean===true&&lap.off_track!==true&&lap.incomplete!==true&&lap.discontinuity!==true).length;
 const validTimes=usable.flat();
 return {samples:items.length,offTrack,incomplete,discontinuity,pitEvent,towConfirmed,retirementSignal,telemetry:{sessions:usable.length,cleanLaps,cleanRate:round(items.length?cleanLaps/items.length*100:null),bestLap:round(validTimes.length?Math.min(...validTimes):null,3),lapConsistency:round(average(variations),2)},note:"Flags são contadas por volta de sessão de corrida. Off-track é explícito; tow só é confirmado quando o payload o nomeia. Pit + volta interrompida é sinal de retirada, não prova de colisão."};
}