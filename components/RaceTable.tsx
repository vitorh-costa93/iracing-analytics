"use client";

import { useEffect, useState } from "react";

type Race = { id: number; startedAt: string; series: string | null; car: string; track: string; bestLap: string | null; startPosition: number | null; finishPosition: number | null; delta: number | null };

const PAGE_SIZE = 10;

// bestLap now comes pre-formatted from irstats.com (e.g. "1:27.305"), not a number of seconds —
// display it as-is instead of doing time arithmetic on it.
function lapTime(value: string | null) {
  return value ?? "—";
}

function finish(value: number | null) {
  if (value === 1) return <span className="finish-medal gold" title="P1">🏆</span>;
  if (value === 2) return <span className="finish-medal silver" title="P2">🥈</span>;
  if (value === 3) return <span className="finish-medal bronze" title="P3">🥉</span>;
  return value ?? "—";
}

export default function RaceTable({ races }: { races: Race[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(races.length / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
  }, [races]);

  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRaces = races.slice(start, start + PAGE_SIZE);

  return <div className="race-table-wrap">
    <table className="race-table"><thead><tr><th>Data</th><th>Série</th><th>Carro</th><th>Pista</th><th>Melhor volta</th><th>Largada</th><th>Final</th><th>Δ iRating</th></tr></thead><tbody>
      {pageRaces.map((race) => <tr key={race.id}><td>{new Date(race.startedAt).toLocaleDateString("pt-BR")}</td><td>{race.series ?? "Série não informada"}</td><td>{race.car}</td><td>{race.track}</td><td>{lapTime(race.bestLap)}</td><td>{race.startPosition ?? "—"}</td><td>{finish(race.finishPosition)}</td><td className={race.delta === null ? "" : race.delta >= 0 ? "positive" : "negative"}>{race.delta === null ? "—" : `${race.delta > 0 ? "+" : ""}${race.delta}`}</td></tr>)}
    </tbody></table>

    {pageCount > 1 && (
      <div className="race-table-pagination">
        <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</button>
        <span>Página {safePage + 1} de {pageCount} • {races.length} corridas</span>
        <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Próxima</button>
      </div>
    )}
  </div>;
}
