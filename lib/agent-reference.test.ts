import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseAgentReference } from './agent-reference';
function fixture() {
 const csv = 'LapDistPct,SessionTime,Speed,Brake,Throttle,Lat,Lon\n' + Array.from({ length: 201 }, (_, i) => `${i / 200},${i / 2},40,0,1,-22.1,-43.1`).join('\n') + '\n';
 return { metadata: { customerId: 999, carName: 'Car', trackName: 'Track', trackConfig: 'GP', nativeCarId: 5, nativeTrackId: 7 }, lap: { number: 3, time: 100, clean: true, overtake: false, csvGzipBase64: gzipSync(csv).toString('base64') }, sourceFile: 'coach.ibt' };
}
describe('agent reference boundary', () => {
 it('accepts another driver\'s clean lap and marks the filename as agent-owned', () => {
  const r = parseAgentReference(fixture()); expect(r.filename).toBe('agent:coach.ibt'); expect(r.sampleCount).toBe(201); expect(r.channels).toContain('Speed');
 });
 it('rejects an unclean lap', () => { const f = fixture(); f.lap.clean = false; expect(() => parseAgentReference(f)).toThrow(); });
 it('rejects a lap that used P2P/Overtake', () => { const f = fixture(); f.lap.overtake = true; expect(() => parseAgentReference(f)).toThrow(); });
 it('rejects path-like source names', () => { const f = fixture(); f.sourceFile = '..\\x.ibt'; expect(() => parseAgentReference(f)).toThrow(); });
 it('rejects a truncated lap', () => { const f = fixture(); f.lap.csvGzipBase64 = gzipSync('LapDistPct,Speed,Brake,Throttle\n0,10,0,1\n0.1,10,0,1').toString('base64'); expect(() => parseAgentReference(f)).toThrow(); });
});
