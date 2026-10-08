import { describe,it,expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseAgentTelemetry } from './agent-telemetry';
function fixture(){
 const csv='LapDistPct,SessionTime,Lap,Speed,Brake,Throttle,Lat,Lon\n'+Array.from({length:201},(_,i)=>`${i/200},${i/2},1,40,0,1,-22.1,-43.1`).join('\n')+'\n';
 return {metadata:{customerId:42,subsessionId:100,sessionNumber:2,sessionType:'Race',startedAt:'2026-10-07T18:00:00Z',endedAt:'2026-10-07T18:01:40Z',trackLengthMeters:3000,carName:'Car',trackName:'Track',trackConfig:'GP'},lap:{number:1,time:100,clean:true,incidents:0,fuelLevel:40,fuelUsed:2,csvGzipBase64:gzipSync(csv).toString('base64')}};
}
describe('native telemetry boundary',()=>{
 it('accepts bounded full lap and official season boundary',()=>{const t=parseAgentTelemetry(fixture(),42);expect(t.sessionType).toBe(3);expect(t.season.id).toBe('35');expect(t.key).toHaveLength(64);});
 it('rejects identity substitution',()=>expect(()=>parseAgentTelemetry(fixture(),43)).toThrow());
 it('rejects gzip bomb before parsing',()=>{const f=fixture();f.lap.csvGzipBase64=gzipSync(Buffer.alloc(2097153)).toString('base64');expect(()=>parseAgentTelemetry(f,42)).toThrow();});
 it('rejects inconsistent elapsed time',()=>{const f=fixture();f.lap.time=200;expect(()=>parseAgentTelemetry(f,42)).toThrow();});
 it('does not claim qualifying caused iRating activity',()=>{const f=fixture();f.metadata.sessionType='Qualify';expect(parseAgentTelemetry(f,42).sessionType).toBe(2);});
 it('rejects clean lap with incidents',()=>{const f=fixture();f.lap.incidents=1;expect(()=>parseAgentTelemetry(f,42)).toThrow();});
 it('rejects an unknown calendar instead of civil week guessing',()=>{const f=fixture();f.metadata.startedAt='2025-01-01T18:00:00Z';f.metadata.endedAt='2025-01-01T18:01:40Z';expect(()=>parseAgentTelemetry(f,42)).toThrow();});
 it('rejects truncated lap',()=>{const f=fixture();f.lap.csvGzipBase64=gzipSync('LapDistPct,Speed,Brake,Throttle\n0,10,0,1\n0.1,10,0,1').toString('base64');expect(()=>parseAgentTelemetry(f,42)).toThrow();});
});
