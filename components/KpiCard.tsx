import { FlagTriangleRight, Gauge, Trophy } from "lucide-react";

type Props = {
  eyebrow: string;
  value: number | null;
  previousValue: number | null;
  previousLabel: string;
  mode?: "delta" | "count";
  unavailableText?: string;
};

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`;
}

export default function KpiCard({
  eyebrow,
  value,
  previousValue,
  previousLabel,
  mode = "delta",
  unavailableText,
}: Props) {
  const available = value !== null;
  const seasonOverSeason =
    value !== null && previousValue !== null ? value - previousValue : null;

  const valueClass =
    mode === "delta" && value !== null
      ? value > 0
        ? "positive"
        : value < 0
          ? "negative"
          : "neutral"
      : "neutral";
  const category = eyebrow.includes("Formula") ? "formula" : eyebrow.includes("Sports") ? "sports" : "generic";

  return (
    <article className={`kpi-card ${category}`}>
      <div className="kpi-label"><span className="kpi-icon" aria-hidden>{mode === "count" ? <Trophy size={17} /> : category === "formula" ? <FlagTriangleRight size={17} /> : <Gauge size={17} />}</span>{eyebrow}</div>
      <div className={`kpi-main ${valueClass}`}>
        {available
          ? mode === "delta"
            ? signed(value)
            : value.toLocaleString("pt-BR")
          : "—"}
      </div>

      {available ? (
        <div className="kpi-secondary">
          <span>
            {previousLabel}: {previousValue === null ? "—" : mode === "delta" ? signed(previousValue) : previousValue.toLocaleString("pt-BR")}
          </span>
          <span className="kpi-divider" />
          <span>
            SoS: {seasonOverSeason === null ? "—" : signed(seasonOverSeason)}
          </span>
        </div>
      ) : (
        <div className="kpi-unavailable">{unavailableText ?? "Indisponível"}</div>
      )}
    </article>
  );
}
