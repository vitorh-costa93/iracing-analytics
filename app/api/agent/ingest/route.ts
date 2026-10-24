import { CACHE_TAGS as T, withInvalidate } from "@/lib/cache";
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { parseAgentResult, AgentValidationError } from '@/lib/agent-result';
import { parseAgentTelemetry, agentHash } from '@/lib/agent-telemetry';
import { parseAgentReference, AGENT_REFERENCE_PREFIX } from '@/lib/agent-reference';
import { parseAgentIbtResult, IBT_RESULT_MAX_BYTES } from '@/lib/agent-ibt-result';
import { parseAgentIbtSetup, ibtSetupIdentity, IBT_SETUP_MAX_BYTES, IBT_SETUP_SOURCE } from '@/lib/agent-ibt-setup';
import { classifyAgainstFixed, DecodedSetupRow } from '@/lib/setup-params';
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
async function authorize(request:NextRequest){
 const auth=request.headers.get('authorization'); if(!auth||!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth))return null;
 const {data:device,error}=await db.from('agent_devices').select('id,driver_id,customer_id').eq('token_hash',agentHash(auth.slice(7))).eq('enabled',true).maybeSingle();
 if(error)throw new Error('auth');return device;
}
// Subsessions whose official result is already stored (iRStats import or official JSON) AND whose
// full field is stored in race_field_events, so the agent exports only new races (or races still
// missing their field) from the iRacing UI. Bounded: ids only, 120 days, 400 rows, 2 small queries.
export async function GET(request:NextRequest){
 try {
  const device=await authorize(request);if(!device)return reply(401,'unauthorized');
  if(request.nextUrl.searchParams.get('scope')==='all'){
   // Ids only, newest first, hard cap 3000: races whose full field is already stored (any age).
   const {data:all,error:allError}=await db.from('race_field_events').select('subsession_id').eq('my_cust_id',device.customer_id).order('start_time',{ascending:false}).limit(3000);
   if(allError)throw new Error('known');
   return NextResponse.json({known:(all??[]).map(r=>Number(r.subsession_id)).filter(Number.isFinite)},{headers:{'Cache-Control':'no-store'}});
  }
  const since=new Date(Date.now()-120*86400000).toISOString();
  const {data,error}=await db.from('race_results').select('irstats_race_id').eq('driver_id',device.driver_id).gte('raced_at',since)
   .or('result_source.eq.irstats,official_irating_after.not.is.null').order('raced_at',{ascending:false}).limit(400);
  if(error)throw new Error('known');
  const ids=(data??[]).map(r=>Number(r.irstats_race_id)).filter(Number.isFinite);
  const {data:fields,error:fieldError}=ids.length?await db.from('race_field_events').select('subsession_id').eq('my_cust_id',device.customer_id).in('subsession_id',ids):{data:[],error:null};
  if(fieldError)throw new Error('known');
  const withField=new Set((fields??[]).map(r=>Number(r.subsession_id)));
  return NextResponse.json({known:ids.filter(id=>withField.has(id))},{headers:{'Cache-Control':'no-store'}});
 }catch{return reply(503,'temporarily_unavailable',120);}
}
async function handlePost(request:NextRequest){
 try {
  const device=await authorize(request);if(!device)return reply(401,'unauthorized');
  const {body,size}=await boundedBody(request);if(body.version!==1||!['result','telemetry','ibt_result','reference','ibt_setup'].includes(String(body.kind)))throw new AgentValidationError();
  let key:string,hash:string,bytes=0,row:Record<string,unknown>,session:Record<string,unknown>|null=null,gzip:Buffer|null=null,referenceCsv:string|null=null,setupRows:DecodedSetupRow[]|null=null;
  if(body.kind==='result'){
   const result=parseAgentResult(body.export,Number(device.customer_id));
   // New key (not `result:`): receipts of results stored before the field existed keep their old hash,
   // so the same race re-sent with its field is a fresh admission instead of an identity conflict.
   key=`result_field:${result.subsessionId}`;hash=agentHash(JSON.stringify(result));
   const [car,track]=await Promise.all([catalog('cars',result.nativeCarId,result.carName),catalog('tracks',result.nativeTrackId,result.trackName,result.trackConfig)]);
   row={...result.row,driver_id:device.driver_id,irstats_race_id:result.subsessionId,car_id:car,track_id:track};
   session={event:result.event,field:result.field};
  }else if(body.kind==='ibt_result'){
   if(size>IBT_RESULT_MAX_BYTES)throw new AgentValidationError();
   const result=parseAgentIbtResult(body,Number(device.customer_id));
   key=`ibt_result:${result.subsessionId}`;hash=agentHash(JSON.stringify(result));
   const [car,track]=await Promise.all([catalog('cars',result.nativeCarId,result.carName),catalog('tracks',result.nativeTrackId,result.trackName,result.trackConfig)]);
   row={...result.row,series_name:await seriesName(String(device.driver_id),car,track,result.row.raced_at,result.seriesId),driver_id:device.driver_id,irstats_race_id:result.subsessionId,car_id:car,track_id:track};
  }else if(body.kind==='ibt_setup'){
   // CarSetup of the driver's own .ibt -> setup_files (no Storage object: storage_path is a virtual unique id).
   if(size>IBT_SETUP_MAX_BYTES)throw new AgentValidationError();
   const setup=parseAgentIbtSetup(body,Number(device.customer_id));
   const [car,track]=await Promise.all([catalog('cars',setup.nativeCarId,setup.carName),catalog('tracks',setup.nativeTrackId,setup.trackName,setup.trackConfig)]);
   const id=ibtSetupIdentity(setup,car,track);key=id.key;hash=id.hash;bytes=size;setupRows=setup.rows;
   // Same rule as the Garage61 import (one setup per season+car+track): a setup already stored for this context
   // by another source (same parameters) is not stored again.
   const {data:known,error:knownError}=await db.from('setup_files').select('decoded_params').eq('driver_id',device.driver_id).eq('season_id',setup.season.id).eq('car_id',car).eq('track_id',track).neq('source',IBT_SETUP_SOURCE).not('decoded_params','is',null).limit(30);
   if(knownError)throw new Error('setup');
   if(classifyAgainstFixed(setup.rows,(known??[]).map(r=>r.decoded_params))==='fixed')return reply(200,'stored');
   row={driver_id:device.driver_id,season_id:setup.season.id,car_id:car,track_id:track,source:IBT_SETUP_SOURCE,setup_kind:'unknown',filename:id.filename,
    storage_path:`${IBT_SETUP_SOURCE}/${device.driver_id}/${setup.season.id}/${car}/${track}/${setup.identity}`,file_size:Buffer.byteLength(JSON.stringify(setup.rows)),
    decoded_car_name:String(car),decoded_params:setup.rows,decoder:'iracing_ibt'};
  }else if(body.kind==='reference'){
   const ref=parseAgentReference(body);key=`reference:${agentHash(JSON.stringify(body.key))}`;
   const [car,track]=await Promise.all([catalog('cars',ref.nativeCarId,ref.carName),catalog('tracks',ref.nativeTrackId,ref.trackName,ref.trackConfig)]);
   // A reference uploaded by hand is never replaced by the agent (it also owns the same Storage path).
   const {data:existing,error:existingError}=await db.from('telemetry_references').select('original_filename').eq('driver_id',device.driver_id).eq('car_id',car).eq('track_id',track).maybeSingle();
   if(existingError)throw new Error('reference');
   if(existing && !String(existing.original_filename).startsWith(AGENT_REFERENCE_PREFIX))return reply(200,'kept_manual');
   const path=`${device.driver_id}/${car}/${track}/reference.csv`;
   row={driver_id:device.driver_id,car_id:car,track_id:track,storage_path:path,original_filename:ref.filename,file_size:Buffer.byteLength(ref.csv),channels:ref.channels,sample_count:ref.sampleCount};
   hash=agentHash(JSON.stringify(row)+agentHash(ref.gzip));bytes=ref.gzip.length;referenceCsv=ref.csv;
  }else{
   const t=parseAgentTelemetry(body,Number(device.customer_id));key=`lap_v2:${t.key}`;
   const [car,track]=await Promise.all([catalog('cars',t.nativeCarId,t.carName),catalog('tracks',t.nativeTrackId,t.trackName,t.trackConfig)]);
   const lapId=`ira_${agentHash(`${device.driver_id}:${t.key}`)}`,event=`iracing:${t.sub}`,nativeSession=String(t.session);
   row={id:lapId,driver_id:device.driver_id,car_id:car,track_id:track,lap_number:t.number,lap_time:t.time,clean:t.clean,fuel_level:t.fuelLevel,fuel_used:t.fuelUsed,created_at:t.startedAt,telemetry_path:`laps/${track}/${lapId}.csv.gz`,garage61_payload:{id:lapId,event,nativeSession,sessionType:t.sessionType,startTime:t.startedAt,trackLengthMeters:t.trackLength,incidents:t.incidents,pushToPass:t.overtake,source:'iracing_agent',lapTime:t.time,clean:t.clean,canViewTelemetry:true,season:{id:Number(t.season.id),name:t.season.name}}};
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
  if(setupRows!==null){
   // Fixed vs unknown (never 'commercial'): equality with a fixed setup already known for this car (lib/setup-params.ts).
   const {data:fixed,error:fixedError}=await db.from('setup_files').select('decoded_params').eq('driver_id',device.driver_id).eq('car_id',Number(row.car_id)).eq('setup_kind','fixed')
    .neq('source',IBT_SETUP_SOURCE).not('decoded_params','is',null).order('updated_at',{ascending:false}).limit(30);
   if(fixedError)throw new Error('setup');
   row.setup_kind=classifyAgainstFixed(setupRows,(fixed??[]).map(r=>r.decoded_params));
   const {error:setupCommitError}=await db.rpc('agent_commit_setup',{p_device:device.id,p_key:key,p_lease:admission.lease,p_row:row});
   if(setupCommitError)throw new Error('commit');return reply(200,'stored');
  }
  if(referenceCsv!==null){
   const {error:refUploadError}=await db.storage.from('telemetry-references').upload(String(row.storage_path),new Blob([referenceCsv],{type:'text/csv'}),{upsert:true,contentType:'text/csv'});
   if(refUploadError)throw new Error('upload');
   const {error:refCommitError}=await db.rpc('agent_commit_reference',{p_device:device.id,p_key:key,p_lease:admission.lease,p_row:row});
   if(refCommitError)throw new Error('commit');return reply(200,'stored');
  }
  const {error:commitError}=await db.rpc('agent_commit',{p_device:device.id,p_key:key,p_lease:admission.lease,p_kind:body.kind,p_row:row,p_session:session});
  if(commitError)throw new Error('commit');return reply(200,'stored');
 }catch(error){if(error instanceof AgentValidationError)return reply(422,'invalid_payload');return reply(503,'temporarily_unavailable',120);}
}

export const POST = withInvalidate(handlePost, [T.results, T.laps, T.telemetryRef, T.syncStatus]);
