"use client";

import { useEffect, useState } from "react";

type Race = { id: number; startedAt: string; series: string | null; car: string; track: string; bestLap: string | null; startPosition: number | null; finishPosition: number | null; delta: number | null; ratingCategory?: "formula_car" | "sports_car" | null };

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
    {/* Category swatch column (02/09/2026, "conseguiríamos trazer mais coisas próprias do iRacing pra
     * cá") -- iRacing's own relative/standings box marks each row with a small fixed color swatch by
     * class, at a glance, before you read the car name. This table mixes every category in one list
     * (unlike the KPI cards), so a swatch here is a legitimate category-color use, not the generic-
     * chrome misuse fixed elsewhere -- --blue/--amber really do mean Formula/Sports on these rows. */}
    <table className="race-table"><thead><tr><th aria-label="Categoria"></th><th>Data</th><th>Série</th><th>Carro</th><th>Pista</th><th>Melhor volta</th><th>Largada</th><th>Final</th><th>Δ iRating</th></tr></thead><tbody>
      {pageRaces.map((race) => <tr key={race.id}><td><span className={`race-category-swatch ${race.ratingCategory ?? ""}`} title={race.ratingCategory === "formula_car" ? "Formula Car" : race.ratingCategory === "sports_car" ? "Sports Car" : undefined} /></td><td>{new Date(race.startedAt).toLocaleDateString("pt-BR")}</td><td>{race.series ?? "Série não informada"}</td><td>{race.car}</td><td>{race.track}</td><td>{lapTime(race.bestLap)}</td><td>{race.startPosition ?? "—"}</td><td>{finish(race.finishPosition)}</td><td className={race.delta === null ? "" : race.delta >= 0 ? "positive" : "negative"}>{race.delta === null ? "—" : `${race.delta > 0 ? "+" : ""}${race.delta}`}</td></tr>)}
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
