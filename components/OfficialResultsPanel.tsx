"use client";

import { useState } from "react";

type Props = {
  onImported: () => Promise<void> | void;
};

export default function OfficialResultsUpload({ onImported }: Props) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setMessage("Importando CSV de resultados...");
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
      window.setTimeout(() => setMessage(null), 6000);
    }
  }

  return (
    <div className="header-csv-upload">
      <label className={`secondary-button ${uploading ? "disabled" : ""}`} title="Envie um CSV com: season_id,season_name,rating_category,series_name,starts,wins">
        {uploading ? "Importando..." : "Enviar CSV de vitórias"}
        <input type="file" accept=".csv,text/csv" disabled={uploading} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = "";
        }} />
      </label>
      {message && <span className="header-csv-message">{message}</span>}
    </div>
  );
}
