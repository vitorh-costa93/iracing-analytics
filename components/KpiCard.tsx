type Props = { eyebrow: string; value: number | null; previousValue: number | null; previousLabel: string; mode?: "irating" | "wins"; displayValue?: string | null };

function RaceCarIcon({ formula }: { formula: boolean }) {
  return <svg viewBox="0 0 32 20" aria-hidden>{formula ? <><path d="M3 10h6l3-5h8l2 5h7v4h-5l-2 3H10l-2-3H3z" /><circle cx="9" cy="16" r="3" /><circle cx="23" cy="16" r="3" /><path d="M14 5V2h5v3M2 7h7v3H2z" /></> : <><path d="M3 13l3-7h5l3-3h8l4 3 3 7v3H3z" /><circle cx="9" cy="16" r="3" /><circle cx="24" cy="16" r="3" /><path d="M11 6h12l2 5H8z" /></>}</svg>;
}
function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`; }

export default function KpiCard({ eyebrow, value, previousValue, previousLabel, mode = "irating", displayValue }: Props) {
  const formula = eyebrow.includes("Formula");
  const comparison = value !== null && previousValue !== null ? value - previousValue : null;
  const display = value === null ? "—" : displayValue ?? value.toLocaleString("pt-BR");
  return <article className={`kpi-card ${formula ? "formula" : "sports"}`}>
    <div className="kpi-card-top"><span className="kpi-label">{eyebrow}</span><span className="kpi-icon"><RaceCarIcon formula={formula} /></span></div>
    <div className="kpi-main">{display}</div>
    <div className={`kpi-trend ${comparison !== null && comparison < 0 ? "negative" : "positive"}`}>{comparison === null ? "Sem comparação anterior" : `${comparison >= 0 ? "↗" : "↘"} ${signed(comparison)} vs. ${previousLabel}`}</div>
    <div className="kpi-description">{mode === "wins" ? `Vitórias registradas • ${previousLabel}: ${previousValue?.toLocaleString("pt-BR") ?? "—"}` : `iRating atual • ${previousLabel} na mesma week: ${previousValue?.toLocaleString("pt-BR") ?? "—"}`}</div>
  </article>;
}
