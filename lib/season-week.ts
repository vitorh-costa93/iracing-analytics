/** Numeração única de weeks da season, usada por todas as telas. A numeração é a do iRacing
 * (1 a 12, a Week 1 começa no início da season) e é a mesma de `season_week` no banco. */

/** "Semana 2" (texto por extenso, eyebrows e cartões). */
export function weekLabel(week: number): string {
  return "Semana " + week;
}

/** "W2" (rótulo curto de gráficos). */
export function weekShort(week: number): string {
  return "W" + week;
}

/** Week atual da season: a maior week com corrida em QUALQUER categoria. Não pode depender do
 * segmento selecionado, senão um segmento sem corrida na week atual mostraria a week anterior. */
export function currentSeasonWeek(rows: Array<{ season_week: number | null }>): number | null {
  let latest: number | null = null;
  for (const row of rows) if (row.season_week !== null && (latest === null || row.season_week > latest)) latest = row.season_week;
  return latest;
}
