import {expect,it} from 'vitest';
import {keepTelemetry} from './telemetry-retention';
it('keeps native current-season telemetry even without a Garage61 season payload',()=>expect(keepTelemetry({data_source:'iracing_agent',created_at:'2026-10-14T13:00:00Z'},'2026 Season 4','2026 Season 3')).toBe(true));
it('does not delete unknown metadata',()=>expect(keepTelemetry({},'2026 Season 4','2026 Season 3')).toBe(true));
it('keeps previous-season races, not qualifying',()=>{expect(keepTelemetry({garage61_payload:{season:{name:'2026 Season 3'},sessionType:3}},'2026 Season 4','2026 Season 3')).toBe(true);expect(keepTelemetry({garage61_payload:{season:{name:'2026 Season 3'},sessionType:2}},'2026 Season 4','2026 Season 3')).toBe(false);});
it('expires older seasons',()=>expect(keepTelemetry({garage61_payload:{season:{name:'2026 Season 2'},sessionType:3}},'2026 Season 4','2026 Season 3')).toBe(false));
