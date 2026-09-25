"use client";

import { useEffect, useState } from "react";
import { signedNumber } from "./format";

export type OverviewRace = { id: number; startedAt: string; series: string | null; car: string; track: string; startPosition: number | null; finishPosition: number | null; delta: number | null; ratingCategory?: "formula_car" | "sports_car" | "road" | null };

const PAGE_SIZE = 10;
const CATEGORY_COLOR: Record<string, string> = { sports_car: "var(--ng-sports)", formula_car: "var(--ng-formula)", road: "var(--ng-road)" };

/** "Últimas corridas" do mockup: colunas Data, Pista, Carro, Grid, Pos., iRating. A coluna Inc. do
 * mockup fica de fora porque o payload do overview não traz incidentes. Mantém a paginação da tabela
 * anterior para a temporada inteira continuar acessível. */
export default function LatestRaces({ races }: { races: OverviewRace[] }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [races]);
  const pageCount = Math.max(1, Math.ceil(races.length / PAGE_SIZE));
  const safe = Math.min(page, pageCount - 1);
  const rows = races.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE);
  return (
    <>
      <div className="ngo-races" role="table" aria-label="Últimas corridas">
        <div className="ngo-races-row ngo-races-head" role="row">
          <div>Data</div><div>Pista</div><div>Carro</div><div className="r">Grid</div><div className="r">Pos.</div><div className="r">iRating</div>
        </div>
        {rows.map((r) => (
          <div className="ngo-races-row" role="row" key={r.id}>
            <div className="ngo-races-date">{new Date(r.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
            <div className="ngo-races-track"><span style={{ background: CATEGORY_COLOR[r.ratingCategory ?? ""] ?? "var(--ng-soft)" }} />{r.track}</div>
            <div className="ngo-races-car" title={r.series ?? undefined}>{r.car}</div>
            <div className="r ngo-races-grid">{r.startPosition ?? "—"}</div>
            <div className="r ngo-races-pos">{r.finishPosition !== null ? `P${r.finishPosition}` : "—"}</div>
            <div className="r ngo-races-delta" style={{ color: r.delta === null ? "var(--ng-muted)" : r.delta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)" }}>{r.delta === null ? "—" : signedNumber(r.delta)}</div>
            <div className="ngo-races-mobile-sub">{r.car}{r.finishPosition !== null ? ` · P${r.finishPosition}` : ""}</div>
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="ngo-pager">
          <button type="button" disabled={safe === 0} onClick={() => setPage(safe - 1)}>Anterior</button>
          <span>Página {safe + 1} de {pageCount} · {races.length} corridas</span>
          <button type="button" disabled={safe >= pageCount - 1} onClick={() => setPage(safe + 1)}>Próxima</button>
        </div>
      )}
    </>
  );
}
