import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { parseAgentResult, AgentValidationError } from '@/lib/agent-result';
import { parseAgentTelemetry, agentHash } from '@/lib/agent-telemetry';
import { parseAgentIbtResult, IBT_RESULT_MAX_BYTES } from '@/lib/agent-ibt-result';
export const runtime='nodejs';
export const maxDuration=30;
const reply=(status:number,code:string,retry?:number)=>NextResponse.json({status:code},{status,headers:{'Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})}});
async function boundedBody(request:Request) {
 if(Number(request.headers.get('content-length')??0)>1048576) throw new AgentValidationError();
 if(!request.body) throw new AgentValidationError();
 const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
 try { for(;;){const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>1048576){await reader.cancel();throw new AgentValidationError();}chunks.push(value);} }
 finally {reader.releaseLock();}
 try {return {body:JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>,size};}catch{throw new AgentValidationError();}
}
async function catalog(table:'cars'|'tracks',nativeId:number|null,name:string,config?:string|null):Promise<number> {
 let query=db.from(table).select('id').eq('platform','iracing');
 if(nativeId!==null) query=query.eq('platform_id',String(nativeId));
 else {query=query.eq('name',name);if(table==='tracks')query=config?query.eq('variant',config):query.is('variant',null);}
 const {data,error}=await query.limit(2); if(error)throw new Error('catalog');
 if(data?.length!==1)throw new AgentValidationError();return Number(data[0].id);
}
// SessionInfo has no series name. Reuse the series of this driver's own race with the same
// car+track within a week only when it is unambiguous; otherwise a neutral label. The official
// JSON or a later iRStats import replaces the row anyway.
async function seriesName(driverId:string,car:number,track:number,racedAt:string,seriesId:number):Promise<string> {
 const at=Date.parse(racedAt),week=7*86400000;
 const {data,error}=await db.from('race_results').select('series_name').eq('driver_id',driverId).eq('car_id',car).eq('track_id',track)
  .gte('raced_at',new Date(at-week).toISOString()).lte('raced_at',new Date(at+week).toISOString()).neq('result_source','iracing_ibt').limit(50);
 if(error)throw new Error('series');
 const names=[...new Set((data??[]).map(row=>String(row.series_name)))];
 return names.length===1?names[0]:`iRacing série ${seriesId}`;
}
export async function POST(request:NextRequest){
 try {
  const auth=request.headers.get('authorization'); if(!auth||!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth))return reply(401,'unauthorized');
  const {data:device,error}=await db.from('agent_devices').select('id,driver_id,customer_id').eq('token_hash',agentHash(auth.slice(7))).eq('enabled',true).maybeSingle();
  if(error)throw new Error('auth');if(!device)return reply(401,'unauthorized');
  const {body,size}=await boundedBody(request);if(body.version!==1||!['result','telemetry','ibt_result'].includes(String(body.kind)))throw new AgentValidationError();
  let key:string,hash:string,bytes=0,row:Record<string,unknown>,session:Record<string,unknown>|null=null,gzip:Buffer|null=null;
  if(body.kind==='result'){
   const result=parseAgentResult(body.export,Number(device.customer_id));
   key=`result:${result.subsessionId}`;hash=agentHash(JSON.stringify(result));
   const [car,track]=await Promise.all([catalog('cars',result.nativeCarId,result.carName),catalog('tracks',result.nativeTrackId,result.trackName,result.trackConfig)]);
   row={...result.row,driver_id:device.driver_id,irstats_race_id:result.subsessionId,car_id:car,track_id:track};
  }else if(body.kind==='ibt_result'){
   if(size>IBT_RESULT_MAX_BYTES)throw new AgentValidationError();
   const result=parseAgentIbtResult(body,Number(device.customer_id));
   key=`ibt_result:${result.subsessionId}`;hash=agentHash(JSON.stringify(result));
   const [car,track]=await Promise.all([catalog('cars',result.nativeCarId,result.carName),catalog('tracks',result.nativeTrackId,result.trackName,result.trackConfig)]);
   row={...result.row,series_name:await seriesName(String(device.driver_id),car,track,result.row.raced_at,result.seriesId),driver_id:device.driver_id,irstats_race_id:result.subsessionId,car_id:car,track_id:track};
  }else{
   const t=parseAgentTelemetry(body,Number(device.customer_id));key=`lap:${t.key}`;
   const [car,track]=await Promise.all([catalog('cars',t.nativeCarId,t.carName),catalog('tracks',t.nativeTrackId,t.trackName,t.trackConfig)]);
   const lapId=`ira_${agentHash(`${device.driver_id}:${t.key}`)}`,event=`iracing:${t.sub}`,nativeSession=String(t.session);
   row={id:lapId,driver_id:device.driver_id,car_id:car,track_id:track,lap_number:t.number,lap_time:t.time,clean:t.clean,fuel_level:t.fuelLevel,fuel_used:t.fuelUsed,created_at:t.startedAt,telemetry_path:`laps/${track}/${lapId}.csv.gz`,garage61_payload:{event,nativeSession,sessionType:t.sessionType,startTime:t.startedAt,trackLengthMeters:t.trackLength,incidents:t.incidents,source:'iracing_agent'}};
   session={driver_id:device.driver_id,car_id:car,track_id:track,garage61_event_id:event,garage61_session_id:nativeSession,session_type:t.sessionType,started_at:t.startedAt,ended_at:t.endedAt,season_id:t.season.id,season_name:t.season.name};
   hash=agentHash(JSON.stringify(row)+agentHash(t.gzip));bytes=t.gzip.length;gzip=t.gzip;
  }
  const {data:admission,error:admissionError}=await db.rpc('agent_reserve',{p_device:device.id,p_key:key,p_hash:hash,p_bytes:bytes});
  if(admissionError)throw new Error('admission');
  if(admission.status==='duplicate')return reply(200,'duplicate');
  if(admission.status==='unauthorized')return reply(401,'unauthorized');
  if(admission.status==='conflict')return reply(422,'identity_conflict');
  if(admission.status!=='accepted')return reply(429,admission.status,admission.status==='busy'?120:admission.status==='storage'?86400:3600);
  if(gzip){const {error:uploadError}=await db.storage.from('telemetry').upload(String(row.telemetry_path),gzip,{contentType:'application/gzip',upsert:false});if(uploadError && !['409'].includes(String('statusCode' in uploadError?uploadError.statusCode:'')))throw new Error('upload');}
  const {error:commitError}=await db.rpc('agent_commit',{p_device:device.id,p_key:key,p_lease:admission.lease,p_kind:body.kind,p_row:row,p_session:session});
  if(commitError)throw new Error('commit');return reply(200,'stored');
 }catch(error){if(error instanceof AgentValidationError)return reply(422,'invalid_payload');return reply(503,'temporarily_unavailable',120);}
}
