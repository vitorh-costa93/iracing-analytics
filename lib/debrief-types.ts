import type { PaceChart } from "@/lib/debrief-charts";
import type { RichText } from "@/lib/debrief-narrative";

/** Contrato do GET /api/dashboard/report consumido por app/debriefs (redesign etapa 5). Mudou de
 * forma em 25/09/2026: o cache local do navegador subiu para v6 (components/debriefs/DebriefsView.tsx). */

export type DebriefRaceRow = { date: string; track: string; car: string; grid: number | null; finish: number; sof: number | null; delta: number; lossShare: number | null; severe: boolean };
export type DebriefContextRow = { track: string; car: string; races: number; delta: number };
export type IncidentStats = { races: number; average: number | null; highCount: number; highRate: number | null };
export type RetirementItem = { date: string; track: string; car: string; type: string; confidence: "driver" | "confirmed" | "probable"; completedLaps: number; delta: number };
export type PedalSet = { brake: number | null; throttle: number | null; steering: number | null };

export type DebriefSection = {
  segment: string;
  label: string;
  week: number | null;
  confidence: "alta" | "média" | "baixa";
  races: number;
  referenceRaces: number;
  narrative: { summary: string; paceVsResult: string; action: string; lossTiming: RichText; trendSubtitle: string };
  kpis: {
    net: number;
    /** Season: saldo total da season anterior. Week: média por corrida das demais weeks. */
    referenceNet: number | null;
    severeCount: number;
    severeThreshold: number;
    retirements: number;
    retirementRate: number | null;
    incidentsAvg: number | null;
    incidentsRef: number | null;
    streak: { length: number; direction: "gain" | "loss" | null; recordGain: number; recordLoss: number };
  };
  pace: PaceChart;
  lossTiming: { current: number[]; reference: number[]; currentSample: number; referenceSample: number };
  weeks: Array<{ week: number; delta: number; races: number; severeLosses: number }>;
  raceList: DebriefRaceRow[];
  impactRaces: DebriefRaceRow[];
  contexts: { losses: DebriefContextRow[]; gains: DebriefContextRow[] };
  evidence: {
    incidents: { current: IncidentStats; reference: IncidentStats };
    retirements: { items: RetirementItem[]; currentCount: number; referenceCount: number; currentRate: number | null; referenceRate: number | null };
    pedals: { current: PedalSet; reference: PedalSet; laps: number; referenceLaps: number; gapDeltaSeconds: number | null; stdDeltaSeconds: number | null; note: string | null };
    streaks: { gain: number; loss: number; referenceGain: number; referenceLoss: number; recordGain: number };
    method: string[];
  };
};

export type DebriefReport = { status: "ok"; scope: "week" | "season"; seasonName: string; previousSeasonName: string; generatedAt: string; sections: DebriefSection[] };
