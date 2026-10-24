import { AgentValidationError } from './agent-result';
import { agentHash } from './agent-telemetry';
import { getActiveSeason } from './season-calendar';
import { DecodedSetupRow, SetupParameters, setupIdentityHash, setupParamsToRows } from './setup-params';

/** Request cap for `kind: "ibt_setup"` (agent/README.md). A real CarSetup is a few KiB. */
export const IBT_SETUP_MAX_BYTES = 64 * 1024;
export const IBT_SETUP_SOURCE = 'ibt_setup';
const MAX_PARAMS = 800;

function invalid(): never { throw new AgentValidationError(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function name(value: unknown, empty = false) { if (typeof value !== 'string' || value.length > 300 || (!empty && !value.trim()) || /[\u0000-\u001f]/.test(value)) invalid(); return value.trim(); }
function nativeId(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) invalid(); return value; }
function instant(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) invalid(); const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2008 || date.getTime() > Date.now() + 86400000) invalid(); return date; }
const KEY = /^[A-Za-z0-9_]{1,64}$/;

/** Validates the CarSetup tree (tab -> section -> label -> string): identifiers only as keys, short scalar strings as values. */
function parameters(value: unknown): SetupParameters {
  const tabs = object(value), out: SetupParameters = {}; let count = 0;
  for (const [tab, sectionsValue] of Object.entries(tabs)) {
    if (!KEY.test(tab)) invalid();
    const sections = object(sectionsValue); out[tab] = {};
    for (const [section, labelsValue] of Object.entries(sections)) {
      if (!KEY.test(section)) invalid();
      const labels = object(labelsValue); out[tab][section] = {};
      for (const [label, metric] of Object.entries(labels)) {
        if (!KEY.test(label) || typeof metric !== 'string' || metric.length > 120 || /[\u0000-\u001f]/.test(metric)) invalid();
        out[tab][section][label] = metric.trim();
        if (++count > MAX_PARAMS) invalid();
      }
    }
  }
  if (count === 0) invalid();
  return out;
}

export type AgentIbtSetup = {
  nativeCarId: number; nativeTrackId: number; carName: string; trackName: string; trackConfig: string;
  season: { id: string; name: string }; rows: DecodedSetupRow[]; identity: string;
};

/**
 * `kind: "ibt_setup"`: the CarSetup section of the authenticated driver's own .ibt, already reduced to the
 * same tree Garage61 exposes as `run.setup.parameters`. Never the raw YAML, never names.
 */
export function parseAgentIbtSetup(payload: unknown, customerId: number): AgentIbtSetup {
 const body = object(payload);
 if (body.version !== 1 || body.kind !== 'ibt_setup' || typeof body.key !== 'string' || !/^[a-f0-9]{64}$/.test(body.key)) invalid();
 const s = object(body.setup);
 if (s.customerId !== customerId) invalid();
 const recordedAt = instant(s.recordedAt);
 const season = getActiveSeason(recordedAt); if (!season) invalid();
 const rows = setupParamsToRows(parameters(s.parameters));
 return {
  nativeCarId: nativeId(s.nativeCarId), nativeTrackId: nativeId(s.nativeTrackId),
  carName: name(s.carName), trackName: name(s.trackName), trackConfig: name(s.trackConfig ?? '', true),
  season: { id: season.id, name: season.name }, rows, identity: setupIdentityHash(rows),
 };
}

/** Deterministic receipt key / body hash / stable filename for one distinct setup per season+car+track. */
export function ibtSetupIdentity(setup: Pick<AgentIbtSetup, 'season' | 'identity'>, carId: number, trackId: number) {
 const digest = agentHash(`${setup.season.id}:${carId}:${trackId}:${setup.identity}`);
 return { key: `ibt_setup:${digest}`, hash: digest, filename: `IBT ${setup.identity.slice(0, 8)}` };
}
