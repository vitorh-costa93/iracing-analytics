type Race = { id: number; startedAt: string; series: string | null; car: string; track: string; bestLap: number | null; startPosition: number | null; finishPosition: number | null; delta: number | null };

function lapTime(value: number | null) {
  if (value === null) return "—";
  const minutes = Math.floor(value / 60), seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export default function RaceTable({ races }: { races: Race[] }) {
  return <div className="race-table-wrap"><table className="race-table"><thead><tr><th>Data</th><th>Série</th><th>Carro</th><th>Pista</th><th>Melhor volta</th><th>Largada</th><th>Final</th><th>Δ iRating</th></tr></thead><tbody>
    {races.map((race) => <tr key={race.id}><td>{new Date(race.startedAt).toLocaleDateString("pt-BR")}</td><td>{race.series ?? "Série não informada"}</td><td>{race.car}</td><td>{race.track}</td><td>{lapTime(race.bestLap)}</td><td>{race.startPosition ?? "—"}</td><td>{race.finishPosition ?? "—"}</td><td className={race.delta === null ? "" : race.delta >= 0 ? "positive" : "negative"}>{race.delta === null ? "—" : `${race.delta > 0 ? "+" : ""}${race.delta}`}</td></tr>)}
  </tbody></table></div>;
}
