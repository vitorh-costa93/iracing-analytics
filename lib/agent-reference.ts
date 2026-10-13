import { AgentValidationError } from './agent-result';
import { parseLapCsv } from './agent-telemetry';

function invalid(): never { throw new AgentValidationError(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function name(value: unknown, empty = false) { if (typeof value !== 'string' || value.length > 300 || (!empty && !value.trim()) || /[\u0000-\u001f]/.test(value)) invalid(); return value.trim(); }
function nativeId(value: unknown) { if (value === undefined) return null; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) invalid(); return value; }

/** Prefix of telemetry_references.original_filename that marks a reference placed by the agent (a manual upload never has it). */
export const AGENT_REFERENCE_PREFIX = 'agent:';

/**
 * Reference lap read by the agent from another driver's .ibt (Documents\iRacing\setups\<car>\<season>\).
 * The lap does not belong to the authenticated customer, so there is no customerId check; instead it must be a
 * clean full lap without P2P/Overtake. Only the CSV of that single lap is kept, never the raw .ibt.
 */
export function parseAgentReference(payload: unknown) {
 const body = object(payload), m = object(body.metadata), lap = object(body.lap);
 const time = lap.time; if (typeof time !== 'number' || !Number.isFinite(time) || time < 10 || time > 3600) invalid();
 if (lap.clean !== true || lap.overtake === true) invalid();
 const source = typeof body.sourceFile === 'string' && body.sourceFile.length <= 200 && !/[\u0000-\u001f\\/]/.test(body.sourceFile) ? body.sourceFile : invalid();
 const { gzip, csv, trace } = parseLapCsv(lap.csvGzipBase64);
 const lines = csv.split('\n').filter((line) => line.trim());
 return {
  carName: name(m.carName), trackName: name(m.trackName), trackConfig: name(m.trackConfig, true),
  nativeCarId: nativeId(m.nativeCarId), nativeTrackId: nativeId(m.nativeTrackId),
  time, gzip, csv, channels: trace.channels, sampleCount: lines.length - 1, sourceFile: source,
  filename: `${AGENT_REFERENCE_PREFIX}${source}`.slice(0, 255),
 };
}
