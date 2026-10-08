import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseTelemetryCsv } from './telemetry-trace';
import { AgentValidationError } from './agent-result';
import { getActiveSeason } from './season-calendar';

function invalid(): never { throw new AgentValidationError(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function integer(value: unknown, min: number, max: number) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(); return value; }
function finite(value: unknown, min: number, max: number) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(); return value; }
function name(value: unknown, empty = false) { if (typeof value !== 'string' || value.length > 300 || (!empty && !value.trim()) || /[\u0000-\u001f]/.test(value)) invalid(); return value.trim(); }
function instant(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) invalid(); const date=new Date(value); if (!Number.isFinite(date.getTime()) || date.getUTCFullYear()<2008 || date.getTime()>Date.now()+86400000) invalid(); return date.toISOString(); }
export const agentHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function parseAgentTelemetry(payload: unknown, customerId: number) {
 const body=object(payload), m=object(body.metadata), lap=object(body.lap);
 if (m.customerId!==customerId) invalid();
 const sub=integer(m.subsessionId,1,Number.MAX_SAFE_INTEGER), session=integer(m.sessionNumber,0,100);
 const number=integer(lap.number,1,10000), time=finite(lap.time,10,3600);
 const kind=m.sessionType; if(kind!=='Race'&&kind!=='Practice'&&kind!=='Qualify') invalid();
 const startedAt=instant(m.startedAt), endedAt=instant(m.endedAt);
 const duration=(Date.parse(endedAt)-Date.parse(startedAt))/1000; if(Math.abs(duration-time)>1) invalid();
 if(typeof lap.clean!=='boolean') invalid();
 const incidents=lap.incidents===null?null:integer(lap.incidents,0,1000);
 if(lap.clean && incidents!==0) invalid();
 const fuel=(value:unknown)=>value===null?null:finite(value,0,1000);
 const fuelLevel=fuel(lap.fuelLevel), fuelUsed=fuel(lap.fuelUsed);
 const trackLength=finite(m.trackLengthMeters,100,100000);
 const carName=name(m.carName), trackName=name(m.trackName), trackConfig=name(m.trackConfig,true);
 const nativeCarId=m.nativeCarId===undefined?null:integer(m.nativeCarId,1,2147483647);
 const nativeTrackId=m.nativeTrackId===undefined?null:integer(m.nativeTrackId,1,2147483647);
 if(typeof lap.csvGzipBase64!=='string'||lap.csvGzipBase64.length>174764||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(lap.csvGzipBase64)) invalid();
 const gzip=Buffer.from(lap.csvGzipBase64,'base64'); if(gzip.length<20||gzip.length>131072||gzip[0]!==31||gzip[1]!==139) invalid();
 let csv:string; try { csv=gunzipSync(gzip,{maxOutputLength:2097152}).toString('utf8'); } catch { invalid(); }
 if(!csv.startsWith('LapDistPct,')||csv.includes('\0')||csv.split('\n').length>30002) invalid();
 let trace;try {trace=parseTelemetryCsv(csv,{maxPoints:30000});}catch{invalid();}
 if(trace.points.length<30||trace.points.length>30000||trace.points[0].distance>3||trace.points.at(-1)!.distance<97||!trace.channels.includes('Speed')||!trace.channels.includes('Brake')||!trace.channels.includes('Throttle')) invalid();
 const season=getActiveSeason(new Date(startedAt)); if(!season) invalid();
 return {sub,session,number,time,kind,startedAt,endedAt,incidents,clean:lap.clean,fuelLevel,fuelUsed,trackLength,carName,trackName,trackConfig,nativeCarId,nativeTrackId,season,gzip,
   key:agentHash(`${sub}:${customerId}:${session}:${number}`), sessionType:kind==='Race'?3:kind==='Qualify'?2:1};
}
