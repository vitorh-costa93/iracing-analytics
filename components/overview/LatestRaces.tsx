"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signedNumber } from "./format";

export type OverviewRace = { id: number; startedAt: string; series: string | null; car: string; track: string; bestLap?: string | null; startPosition: number | null; finishPosition: number | null; delta: number | null; ratingCategory?: "formula_car" | "sports_car" | "road" | null };

const PAGE_SIZE = 10;
const CATEGORY_COLOR: Record<string, string> = { sports_car: "var(--ng-sports)", formula_car: "var(--ng-formula)", road: "var(--ng-road)" };

/** "Últimas corridas" do mockup: colunas Data (com ano), Série, Pista, Carro, Melhor volta, Grid, Pos., iRating. A coluna Inc. do
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
          <div>Data</div><div>Série</div><div>Pista</div><div>Carro</div><div className="r">Melhor volta</div><div className="r">Grid</div><div className="r">Pos.</div><div className="r">iRating</div><div className="r" aria-label="Race Debrief" />
        </div>
        {rows.map((r) => (
          <div className="ngo-races-row" role="row" key={r.id}>
            <div className="ngo-races-date">{new Date(r.startedAt).toLocaleDateString("pt-BR")}</div>
            <div className="ngo-races-series" title={r.series ?? undefined}>{r.series ?? "Série não informada"}</div>
            <div className="ngo-races-track"><span style={{ background: CATEGORY_COLOR[r.ratingCategory ?? ""] ?? "var(--ng-soft)" }} />{r.track}</div>
            <div className="ngo-races-car">{r.car}</div>
            {/* Melhor volta oficial da corrida já formatada. */}
            <div className="r ngo-races-best">{r.bestLap ?? "—"}</div>
            <div className="r ngo-races-grid">{r.startPosition ?? "—"}</div>
            <div className="r ngo-races-pos">{r.finishPosition !== null ? `P${r.finishPosition}` : "—"}</div>
            <div className="r ngo-races-delta" style={{ color: r.delta === null ? "var(--ng-muted)" : r.delta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)" }}>{r.delta === null ? "—" : signedNumber(r.delta)}</div>
            <div className="r ngo-races-action">
              <Link
                href={`/telemetry?tab=debrief&raceId=${r.id}`}
                className="ngo-race-debrief-btn"
                title="Abrir Race Debrief desta corrida"
                aria-label={`Abrir Race Debrief de ${r.track}`}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
                  <path d="M4.5 9.5 6.5 7l2 1.8L11.5 5.5" />
                </svg>
              </Link>
            </div>
            <div className="ngo-races-mobile-sub">{[new Date(r.startedAt).toLocaleDateString("pt-BR"), r.series, r.car, r.bestLap, r.finishPosition !== null ? `P${r.finishPosition}` : null].filter(Boolean).join(" · ")}</div>
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
