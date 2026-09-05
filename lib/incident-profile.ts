import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";

type Payload={season?:{name?:string};sessionType?:number;event?:string;session?:number|string;tow?:boolean;towed?:boolean;startTime?:string};
type Lap={car_id:number;lap_time:number|null;clean:boolean|null;off_track:boolean|null;incomplete:boolean|null;discontinuity:boolean|null;missing:boolean|null;pit_lane:boolean|null;pit_in:boolean|null;pit_out:boolean|null;garage61_payload:unknown};
const norm=(value:string)=>value.trim().toLocaleLowerCase();
const round=(v:number|null,d=1)=>v===null?null:Number(v.toFixed(d));
const average=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const stdev=(values:number[])=>{const mean=average(values);return mean===null?null:Math.sqrt(average(values.map(v=>(v-mean)**2))??0)};

async function allLaps(driverId:string){
 const out:Lap[]=[];
 for(let from=0;;from+=1000){
  const {data,error}=await supabaseAdmin.from("laps").select("car_id,lap_time,clean,off_track,incomplete,discontinuity,missing,pit_lane,pit_in,pit_out,garage61_payload").eq("driver_id",driverId).range(from,from+999);
  if(error)throw error;out.push(...((data??[]) as Lap[]));if(!data||data.length<1000)return out;
 }
}

export async function incidentProfile(driverId:string,category:Category,rows:RaceInput[],seasonName:string){
 const carNames=new Set(rows.map(row=>norm(row.car_name)));
 if(!carNames.size)return{samples:0,offTrack:0,incomplete:0,discontinuity:0,pitEvent:0,towConfirmed:0,retirementSignal:0,telemetry:{sessions:0,cleanLaps:0,cleanRate:null,bestLap:null,lapConsistency:null},note:"Sem corridas suficientes para associar flags de volta."};
 const [{data:cars,error:carsError},laps]=await Promise.all([supabaseAdmin.from("cars").select("id,name"),allLaps(driverId)]);
 if(carsError)throw carsError;
 const eligibleCars=new Set((cars??[]).filter(car=>car.name&&carNames.has(norm(car.name))).map(car=>car.id));
 const times=rows.map(row=>new Date(row.raced_at).getTime()).filter(Number.isFinite),minTime=Math.min(...times)-2*3600000,maxTime=Math.max(...times)+3*3600000;
 const items=laps.filter(lap=>{const p=(lap.garage61_payload??{}) as Payload;const time=p.startTime?new Date(p.startTime).getTime():NaN;return eligibleCars.has(lap.car_id)&&p.season?.name===seasonName&&(p.sessionType===2||p.sessionType===3)&&Number.isFinite(time)&&time>=minTime&&time<=maxTime});
 const count=(test:(lap:Lap,payload:Payload)=>boolean)=>items.filter(lap=>test(lap,(lap.garage61_payload??{}) as Payload)).length;
 const offTrack=count(lap=>lap.off_track===true),incomplete=count(lap=>lap.incomplete===true||lap.missing===true),discontinuity=count(lap=>lap.discontinuity===true),pitEvent=count(lap=>lap.pit_lane===true||lap.pit_in===true||lap.pit_out===true),towConfirmed=count((_lap,p)=>p.tow===true||p.towed===true),retirementSignal=count((lap,p)=>(lap.discontinuity===true||lap.incomplete===true||lap.missing===true)&&(lap.pit_in===true||lap.pit_out===true||p.tow===true||p.towed===true));
 const sessions=new Map<string,number[]>();
 for(const lap of items){const p=(lap.garage61_payload??{}) as Payload;const time=typeof lap.lap_time==="number"?lap.lap_time:null;if(lap.clean!==true||lap.off_track===true||lap.incomplete===true||lap.discontinuity===true||time===null||time<=0)continue;const sessionKey=String(lap.car_id)+":"+(p.event??"")+":"+(p.session??"");sessions.set(sessionKey,[...(sessions.get(sessionKey)??[]),time])}
 const usable=[...sessions.values()].filter(sessionTimes=>sessionTimes.length>=3),variations=usable.map(sessionTimes=>{const mean=average(sessionTimes)!;return(stdev(sessionTimes)!/mean)*100}),cleanLaps=items.filter(lap=>lap.clean===true&&lap.off_track!==true&&lap.incomplete!==true&&lap.discontinuity!==true).length,validTimes=usable.flat();
 return{samples:items.length,offTrack,incomplete,discontinuity,pitEvent,towConfirmed,retirementSignal,telemetry:{sessions:usable.length,cleanLaps,cleanRate:round(items.length?cleanLaps/items.length*100:null),bestLap:round(validTimes.length?Math.min(...validTimes):null,3),lapConsistency:round(average(variations),2)},note:"Flags são contadas por volta de corrida dentro do período analisado. Off-track é explícito; tow só é confirmado quando o payload o nomeia. Pit + volta interrompida é sinal de retirada, não prova de colisão."};
}
