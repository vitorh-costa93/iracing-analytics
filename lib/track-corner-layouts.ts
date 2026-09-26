import layouts from "./track-corner-layouts.json";

/** Curva de um traçado canônico: posições em % da volta (LapDistPct), iguais para qualquer carro. */
export type LayoutCorner = { startDistance: number; endDistance: number; distance: number };
export type CornerLayout = { trackName: string; variant: string; laps: number; votes: Record<string, number>; corners: LayoutCorner[] };

/** Chave estável de uma pista: sem acento, minúscula, só letras e números. */
export function trackLayoutKey(trackName: string, variant: string) {
  const clean = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${clean(trackName)}|${clean(variant)}`;
}

const TABLE = layouts as Record<string, CornerLayout>;

/** Traçado canônico da pista, se existir. Sem variante conhecida, só vale quando a pista tem um único traçado. */
export function lookupCornerLayout(trackName: string, variant: string): CornerLayout | null {
  const exact = TABLE[trackLayoutKey(trackName, variant)];
  if (exact) return exact;
  if (variant) return null;
  const prefix = `${trackLayoutKey(trackName, "").split("|")[0]}|`;
  const matches = Object.entries(TABLE).filter(([key]) => key.startsWith(prefix));
  return matches.length === 1 ? matches[0][1] : null;
}

const circularGap = (a: number, b: number) => { const d = Math.abs(a - b) % 100; return Math.min(d, 100 - d); };

/** Escolhe o traçado que MAIS aparece entre as voltas: primeiro a contagem de curvas mais frequente
 * (empate: a mais próxima de `preferredCount`, depois a maior, porque dividir a mais só vira sequência e
 * juntar curvas esconde onde o tempo se perde); entre as voltas com essa contagem, a mais "central",
 * isto é, a que tem a menor distância média das outras. */
export function pickCanonicalLayout(lists: LayoutCorner[][], preferredCount?: number): { corners: LayoutCorner[]; votes: Record<string, number> } | null {
  const usable = lists.filter((list) => list.length >= 3);
  if (!usable.length) return null;
  const votes: Record<string, number> = {};
  for (const list of usable) votes[String(list.length)] = (votes[String(list.length)] ?? 0) + 1;
  const entries = Object.entries(votes).map(([count, n]) => ({ count: Number(count), n }));
  const top = Math.max(...entries.map((entry) => entry.n));
  const tied = entries.filter((entry) => entry.n === top);
  const chosen = tied.length === 1 ? tied[0].count
    : tied.slice().sort((a, b) => (preferredCount === undefined ? 0 : Math.abs(a.count - preferredCount) - Math.abs(b.count - preferredCount)) || b.count - a.count)[0].count;
  const candidates = usable.filter((list) => list.length === chosen);
  const score = (list: LayoutCorner[]) => candidates.reduce((sum, other) => sum + list.reduce((inner, corner, index) => inner + circularGap(corner.distance, other[index].distance), 0), 0);
  const best = candidates.slice().sort((a, b) => score(a) - score(b))[0];
  return { corners: best, votes };
}
