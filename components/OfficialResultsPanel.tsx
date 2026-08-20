"use client";

import { useState } from "react";

type SeriesRow = { seasonId: string; seasonName: string; category: "formula_car" | "sports_car"; series: string; starts: number; wins: number; source: string; capturedAt: string };

type Props = {
  lastCapturedAt: string | null;
  series: SeriesRow[];
  onImported: () => Promise<void> | void;
};

export default function OfficialResultsPanel({ lastCapturedAt, series, onImported }: Props) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const formula = series.filter((row) => row.category === "formula_car");
  const sports = series.filter((row) => row.category === "sports_car");

  async function upload(file: File) {
    setUploading(true);
    setMessage("Lendo e validando CSV...");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/results/official/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao importar CSV");
      setMessage(`${result.imported} série(s) atualizada(s)${result.skipped ? ` • ${result.skipped} linha(s) ignorada(s)` : ""}.`);
      await onImported();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel official-results-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">OFFICIAL RESULTS</span>
          <h2>Vitórias oficiais por série</h2>
          <p>Snapshot manual a partir do Results Archive do iRacing — a API oficial de resultados ainda não libera acesso de terceiros.</p>
        </div>
        <div className="results-freshness">{lastCapturedAt ? `Atualizado em ${new Date(lastCapturedAt).toLocaleString("pt-BR")}` : "Nunca atualizado"}</div>
      </div>

      <label className={`reference-upload ${uploading ? "disabled" : ""}`}>
        {uploading ? "Importando..." : "Enviar CSV de resultados"}
        <input type="file" accept=".csv,text/csv" disabled={uploading} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = "";
        }} />
      </label>
      {message && <p className="reference-message">{message}</p>}

      {series.length > 0 ? (
        <div className="official-results-grid">
          <div className="results-category">
            <div className="results-category-heading"><strong>Formula Car</strong><span>{formula.reduce((sum, row) => sum + row.wins, 0)} vitórias</span></div>
            <div className="results-table">{formula.map((row) => (
              <div className="results-row" key={`${row.seasonId}-${row.series}`}>
                <div><strong>{row.series}</strong><span>{row.seasonName} • {row.starts} largadas</span></div>
                <b>{row.wins}</b>
              </div>
            ))}{!formula.length && <div className="results-row"><span>Sem dados para esta categoria.</span></div>}</div>
          </div>
          <div className="results-category sports">
            <div className="results-category-heading"><strong>Sports Car</strong><span>{sports.reduce((sum, row) => sum + row.wins, 0)} vitórias</span></div>
            <div className="results-table">{sports.map((row) => (
              <div className="results-row" key={`${row.seasonId}-${row.series}`}>
                <div><strong>{row.series}</strong><span>{row.seasonName} • {row.starts} largadas</span></div>
                <b>{row.wins}</b>
              </div>
            ))}{!sports.length && <div className="results-row"><span>Sem dados para esta categoria.</span></div>}</div>
          </div>
        </div>
      ) : (
        <p className="official-results-note">Nenhum resultado oficial carregado ainda. Envie um CSV com as colunas: season_id, season_name, rating_category (formula_car ou sports_car), series_name, starts, wins.</p>
      )}
      <p className="official-results-note">Formato do CSV: <code>season_id,season_name,rating_category,series_name,starts,wins</code>. Reenviar a mesma série (season + nome) atualiza os números existentes.</p>
    </section>
  );
}
