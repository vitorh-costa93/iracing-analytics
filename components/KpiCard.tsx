type Props = { eyebrow: string; value: number | null; previousValue: number | null; previousLabel: string; mode?: "irating" | "wins" | "streak"; displayValue?: string | null; safetyRatingDisplay?: string | null; record?: number };

function RaceCarIcon({ formula }: { formula: boolean }) {
  return <svg viewBox="0 0 32 20" aria-hidden>{formula ? <><path d="M3 10h6l3-5h8l2 5h7v4h-5l-2 3H10l-2-3H3z" /><circle cx="9" cy="16" r="3" /><circle cx="23" cy="16" r="3" /><path d="M14 5V2h5v3M2 7h7v3H2z" /></> : <><path d="M3 13l3-7h5l3-3h8l4 3 3 7v3H3z" /><circle cx="9" cy="16" r="3" /><circle cx="24" cy="16" r="3" /><path d="M11 6h12l2 5H8z" /></>}</svg>;
}
function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`; }

// "A 3.29" -> { letter: "A", value: "3.29" }. iRacing's own license classes: Rookie/D/C/B/A/Pro.
const LICENSE_CLASS: Record<string, string> = { R: "rookie", D: "d", C: "c", B: "b", A: "a", P: "pro" };
function SafetyRatingBadge({ display }: { display: string }) {
  const match = display.trim().match(/^([A-Za-z])\s*(.+)$/);
  if (!match) return <span className="sr-badge sr-badge-a">{display}</span>;
  const [, letter, rest] = match;
  const cls = LICENSE_CLASS[letter.toUpperCase()] ?? "a";
  return <span className={`sr-badge sr-badge-${cls}`} title="Safety Rating (iRacing)">{letter.toUpperCase()} {rest}</span>;
}

export default function KpiCard({ eyebrow, value, previousValue, previousLabel, mode = "irating", displayValue, safetyRatingDisplay, record }: Props) {
  const formula = eyebrow.includes("Formula");
  const display = value === null ? "—" : displayValue ?? value.toLocaleString("pt-BR");

  // 05/09/2026: "corridas seguidas ganhando iRating... embaixo, como Secondary KPI, mostrar o meu
  // recorde all-time" -- streak has no "vs. previous week" comparison the way iRating/wins do (a
  // streak of 0 right now isn't a trend, it's just "sua última corrida nessa carteira perdeu
  // iRating"), so it skips the trend row entirely and uses the description line for the record
  // instead of a previous-period count.
  if (mode === "streak") {
    const n = value ?? 0;
    return <article className={`kpi-card ${formula ? "formula" : "sports"}`}>
      <div className="kpi-card-top"><span className="kpi-label">{eyebrow}</span><span className="kpi-icon"><RaceCarIcon formula={formula} /></span></div>
      <div className="kpi-main-row"><div className="kpi-main">{n}</div></div>
      <div className={`kpi-trend ${n > 0 ? "positive" : "neutral"}`}>{n > 0 ? `${n} corrida${n === 1 ? "" : "s"} seguidas ganhando iRating` : "Última corrida perdeu iRating — sequência zerada"}</div>
      <div className="kpi-description">Recorde all-time • {record ?? "—"} corrida{record === 1 ? "" : "s"} seguidas</div>
    </article>;
  }

  const comparison = value !== null && previousValue !== null ? value - previousValue : null;
  return <article className={`kpi-card ${formula ? "formula" : "sports"}`}>
    <div className="kpi-card-top"><span className="kpi-label">{eyebrow}</span><span className="kpi-icon"><RaceCarIcon formula={formula} /></span></div>
    <div className="kpi-main-row">
      <div className="kpi-main">{display}</div>
      {safetyRatingDisplay && <SafetyRatingBadge display={safetyRatingDisplay} />}
    </div>
    <div className={`kpi-trend ${comparison === null || comparison === 0 ? "neutral" : comparison < 0 ? "negative" : "positive"}`}>{comparison === null ? "Sem comparação anterior" : `${comparison > 0 ? "↗" : comparison < 0 ? "↘" : "→"} ${signed(comparison)} vs. ${previousLabel}`}</div>
    <div className="kpi-description">{mode === "wins" ? `Vitórias registradas • ${previousLabel}: ${previousValue?.toLocaleString("pt-BR") ?? "—"}` : `iRating atual • ${previousLabel} na mesma week: ${previousValue?.toLocaleString("pt-BR") ?? "—"}`}</div>
  </article>;
}
