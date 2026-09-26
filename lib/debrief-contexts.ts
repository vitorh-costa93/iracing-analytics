import type { RaceInput } from "@/lib/race-engineer-analysis";
import type { DebriefContextRow } from "@/lib/debrief-types";

/** Mínimo de corridas para uma combinação carro+pista virar "onde você perde / sustenta ganhos".
 * É o mesmo critério da Visão Geral (aggregateRows em app/page.tsx: `races >= 2`): uma corrida isolada
 * não é sinal de desempenho. Ranking e barra usam a MÉDIA por corrida, nunca a soma. */
export const MIN_CONTEXT_RACES = 2;

const delta = (row: RaceInput) => row.irating_after - row.irating_before;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const round1 = (value: number) => Number(value.toFixed(1));

/** `lossTotal`: soma (positiva) do iRating perdido em todas as corridas do recorte; base do `shareOfLosses`. */
export function buildContexts(rows: RaceInput[], lossTotal: number): { losses: DebriefContextRow[]; gains: DebriefContextRow[] } {
  const groups = new Map<string, RaceInput[]>();
  for (const row of rows) {
    const key = row.track_name + "|" + row.car_name;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const list: DebriefContextRow[] = [...groups.values()]
    .filter((items) => items.length >= MIN_CONTEXT_RACES)
    .map((items) => {
      const total = sum(items.map(delta));
      const positions = items.map((item) => item.position_change).filter((value): value is number => typeof value === "number");
      return {
        track: items[0].track_name,
        car: items[0].car_name,
        races: items.length,
        delta: total,
        avgDelta: round1(total / items.length),
        avgPositionChange: positions.length ? round1(sum(positions) / positions.length) : null,
        shareOfLosses: total < 0 && lossTotal > 0 ? Math.round((Math.abs(total) / lossTotal) * 100) : null,
      };
    });
  return {
    losses: list.filter((item) => item.avgDelta < 0).sort((a, b) => a.avgDelta - b.avgDelta).slice(0, 3),
    gains: list.filter((item) => item.avgDelta > 0).sort((a, b) => b.avgDelta - a.avgDelta).slice(0, 3),
  };
}
