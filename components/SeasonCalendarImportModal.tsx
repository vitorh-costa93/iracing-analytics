"use client";

import { useRef, useState } from "react";
import type { ImportedSeasonCalendar } from "@/lib/season-calendar-import";
import { parseOfficialSeasonCalendar } from "@/lib/season-calendar-import";

type Props = { onImported: () => Promise<void> | void };

async function sha256(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function extractPages(file: File) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Keep worker resolution inside the bundled application. A relative PDF.js default would point
  // at the current route on Vercel and silently fail for a user opening the modal from Overview.
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages: Array<{ page: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({ page: pageNumber, text: content.items.map((item) => "str" in item ? item.str : "").join(" ") });
  }
  return pages;
}

export default function SeasonCalendarImportModal({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<ImportedSeasonCalendar | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Escolha o PDF oficial de calendário do iRacing.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage("O PDF excede o limite de 15 MB.");
      return;
    }
    setPreparing(true);
    setPreview(null);
    setMessage("Lendo o PDF localmente e conferindo as 12 weeks oficiais...");
    try {
      const [pages, hash] = await Promise.all([extractPages(file), sha256(file)]);
      const calendar = parseOfficialSeasonCalendar(pages, file.name, hash);
      setPreview(calendar);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não consegui ler esse calendário.");
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setMessage(null);
    try {
      const response = await fetch("/api/season-calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível aplicar o calendário.");
      await onImported();
      setMessage(result.message ?? "Calendário aplicado.");
      setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível aplicar o calendário.");
    } finally {
      setApplying(false);
    }
  }

  return <>
    <button type="button" className="quick-open-button" onClick={() => { setOpen(true); setMessage(null); }}>Calendário</button>
    {open && <div className="dmaic-modal-backdrop" role="presentation" onMouseDown={() => !preparing && !applying && setOpen(false)}>
      <section className="dmaic-modal calendar-import-modal" role="dialog" aria-modal="true" aria-label="Importar calendário da season" onMouseDown={(event) => event.stopPropagation()}>
        <header className="dmaic-modal-head">
          <div><span className="section-kicker">CALENDÁRIO OFICIAL</span><h2>Importar uma nova season</h2><p>O PDF é lido neste navegador. Apenas a grade validada de SF23, IMSA e GT3 Challenge e o hash do arquivo são persistidos.</p></div>
          <button type="button" className="modal-close" disabled={preparing || applying} onClick={() => setOpen(false)}>Fechar</button>
        </header>
        <div className="calendar-import-body">
          <label className={`calendar-drop ${preparing || applying ? "disabled" : ""}`}>
            <strong>{preparing ? "Lendo calendário..." : "Selecionar PDF oficial"}</strong>
            <span>Reconhece Super Formula 23, IMSA iRacing Series (open) e GT3 Challenge Fixed oficial. GT3 regional é ignorada.</span>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" disabled={preparing || applying} onChange={(event) => void chooseFile(event.target.files?.[0])} />
          </label>
          {preview && <section className="calendar-preview">
            <div><span>SEASON DETECTADA</span><strong>{preview.seasonName}</strong><small>Começa em {new Date(preview.seasonStart).toLocaleDateString("pt-BR", { timeZone: "UTC" })} às 21:00 BRT.</small></div>
            <div><span>GRADE VALIDADA</span><strong>36 contextos</strong><small>12 weeks × SF23, IMSA e GT3 Challenge</small></div>
            <div><span>WEEK 1</span><strong>{preview.contexts.filter((item) => item.weekNumber === 1).map((item) => `${item.seriesName}: ${item.trackName}`).join(" · ")}</strong><small>{preview.sourceFileName}</small></div>
            <button type="button" className="primary-button" disabled={applying} onClick={() => void apply()}>{applying ? "Aplicando..." : "OK — aplicar calendário"}</button>
          </section>}
          {message && <p className={preview ? "calendar-success" : "calendar-import-message"} role="status">{message}</p>}
        </div>
      </section>
    </div>}
  </>;
}
