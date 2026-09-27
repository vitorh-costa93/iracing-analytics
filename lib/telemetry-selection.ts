/**
 * Critério da volta representativa da semana ativa, em texto para o piloto.
 *
 * Restaurado de 94c4d8d:components/ActiveWeekTelemetry.tsx (`selectionExplanation` e
 * `sessionTypeLabel`, auditoria B, 26/09/2026): mesma regra, só a redação em tom de conversa. Usa os
 * dados que /api/telemetry/active-week já entrega (`bestLap.selectionReason` e `sessionTypes`), para o
 * piloto ver se a volta é de corrida, de practice ou só a mais rápida limpa.
 */
export type SelectionReason = "race_best_lap_without_p2p" | "race_best_lap" | "practice_best_lap" | "fastest_clean_lap" | string;

export function sessionTypeLabel(type: number | null | undefined) {
  if (type === 3) return "corrida";
  if (type === 2) return "classificação";
  if (type === 1) return "practice";
  return "sessão registrada";
}

/** "corrida e practice" / "corrida, classificação e practice" (sem repetir). */
function activityList(sessionTypes: number[]) {
  const labels = [...new Set(sessionTypes.map(sessionTypeLabel))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

export function selectionExplanation(item: { sessionTypes: number[]; bestLap: { selectionReason: SelectionReason } | null }) {
  if (!item.bestLap) return "Ainda não há uma volta limpa com telemetria para avaliar neste contexto.";
  const activity = activityList(item.sessionTypes);
  const found = (fallback: string) => ` Nesta semana você andou em: ${activity || fallback}.`;
  switch (item.bestLap.selectionReason) {
    case "race_best_lap_without_p2p": return `Esta é a sua melhor volta de corrida sem P2P/Overtake.${found("sessão registrada")}`;
    case "race_best_lap": return `Esta é a sua melhor volta de corrida.${found("sessão registrada")}`;
    case "practice_best_lap": return `Ainda não há volta de corrida que sirva, então usei a sua melhor volta de practice para preparar a semana.${found("practice")}`;
    default: return `Esta é a sua melhor volta limpa disponível.${found("sessão registrada")}`;
  }
}

/** Legenda da volta: "volta de 24/09/2026 às 21:14" (horário de Brasília). */
export function lapWhenLabel(startTime: string | null | undefined) {
  if (!startTime) return null;
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `volta de ${day} às ${time}`;
}
