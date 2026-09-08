import { ContextCorner } from "@/lib/telemetry-input-profile";

/** 08/09/2026: telemetryInputProfile() detecta curvas independentemente pro período atual e pra
 * referência -- os dois podem achar contagens/posições ligeiramente diferentes de curva (mesmo
 * princípio de lib/telemetry-corner-brakes.ts: ruído de GPS entre voltas). Casa cada curva atual com
 * a curva de referência mais próxima na mesma pista (por peakDistancePct), não por índice, e devolve
 * só as curvas com diferença real de ponto de frenagem, ordenadas pela magnitude da diferença. */

export type CornerDelta = { context: string; corner: number; peakDistancePct: number; currentPct: number | null; referencePct: number | null; deltaPct: number | null; direction: "later" | "earlier" | null };

const MATCH_TOLERANCE_PCT = 5;

export function compareCornerBraking(current: ContextCorner[], reference: ContextCorner[]): CornerDelta[] {
  const referenceByContext = new Map<string, ContextCorner[]>();
  for (const corner of reference) referenceByContext.set(corner.context, [...(referenceByContext.get(corner.context) ?? []), corner]);

  const results: CornerDelta[] = [];
  for (const corner of current) {
    const candidates = referenceByContext.get(corner.context) ?? [];
    const match = candidates.filter((c) => Math.abs(c.peakDistancePct - corner.peakDistancePct) <= MATCH_TOLERANCE_PCT).sort((a, b) => Math.abs(a.peakDistancePct - corner.peakDistancePct) - Math.abs(b.peakDistancePct - corner.peakDistancePct))[0];
    // Uma curva só entra na comparação se as duas janelas tiverem frenagem detectada nela -- sem
    // dado, não dá pra dizer se ficou "mais tarde" ou "mais cedo", e isso pode significar que virou
    // flat-out (ou vice-versa), o que já é coberto por lapsFlatOut, não por um delta de posição.
    if (!match || corner.avgBrakePointPct === null || match.avgBrakePointPct === null) continue;
    const deltaPct = Number((corner.avgBrakePointPct - match.avgBrakePointPct).toFixed(1));
    if (Math.abs(deltaPct) < 0.3) continue; // ruído -- abaixo disso não é uma diferença real de pilotagem
    results.push({
      context: corner.context,
      corner: corner.corner,
      peakDistancePct: corner.peakDistancePct,
      currentPct: corner.avgBrakePointPct,
      referencePct: match.avgBrakePointPct,
      deltaPct,
      direction: deltaPct > 0 ? "later" : "earlier",
    });
  }
  return results.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
}
