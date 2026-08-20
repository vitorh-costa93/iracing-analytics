"use client";

import { useEffect, useState } from "react";
import { Bot, FileUp, FolderSearch, SlidersHorizontal } from "lucide-react";

type SetupContext = {
  key: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  races: number;
  garage61: { scanned: boolean; accessible: boolean; observedLaps: number };
  uploads: { id: string; filename: string; file_size: number; setup_kind: "commercial" | "fixed" | "open" | "unknown"; created_at: string }[];
};
type EngineerResult = { summary: string; limitation: string; recommendations: { adjustment: string; direction: string; why: string; validate: string }[] };
type CompareResult = { summary: string; totalParameters: number; changes: { tab: string; section: string; label: string; before: string; after: string; explanation: string }[] };
type LibraryItem = { carFolder: string; filename: string; provider: string; kind: string; condition: string; track: string; week: number | null; size: number; modifiedAt: string };

export default function SetupLab() {
  const [mode, setMode] = useState<"generator" | "engineer">("generator");
  const [contexts, setContexts] = useState<SetupContext[]>([]);
  const [context, setContext] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeSetupId, setActiveSetupId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [engineerResult, setEngineerResult] = useState<EngineerResult | null>(null);
  const [baseSetupId, setBaseSetupId] = useState("");
  const [comparisonSetupId, setComparisonSetupId] = useState("");
  const [decodeConsent, setDecodeConsent] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [library, setLibrary] = useState<{ total: number; importedAt: string | null; items: LibraryItem[] }>({ total: 0, importedAt: null, items: [] });

  function loadInventory() {
    fetch("/api/setup/inventory", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.status !== "ok") throw new Error(data.message ?? "Erro ao carregar setups");
        const next = (data.contexts ?? []) as SetupContext[];
        setContexts(next);
        setSeasonName(data.season?.name ?? "");
        setContext((current) => next.some((item) => item.key === current) ? current : next[0]?.key ?? "");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }

  useEffect(() => {
    loadInventory();
    fetch("/api/setup/library", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (data.status === "ok") setLibrary({ total: data.total ?? 0, importedAt: data.importedAt ?? null, items: data.items ?? [] }); });
  }, []);

  useEffect(() => {
    if (!context) return;
    const selectedContext = contexts.find((item) => item.key === context);
    if (!selectedContext || selectedContext.garage61.scanned) return;
    setMessage("Consultando setups deste contexto no Garage61...");
    fetch(`/api/setup/inventory?carId=${selectedContext.car.id}&trackId=${selectedContext.track.id}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.status !== "ok") throw new Error(data.message ?? "Erro ao consultar Garage61");
        setContexts(data.contexts ?? []); setMessage(null);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [context, contexts]);

  const selected = contexts.find((item) => item.key === context) ?? null;

  useEffect(() => {
    setActiveSetupId((current) => selected?.uploads.some((item) => item.id === current) ? current : selected?.uploads[0]?.id ?? "");
    setEngineerResult(null);
    setBaseSetupId(selected?.uploads.find((item) => item.setup_kind === "fixed" || /fixed/i.test(item.filename))?.id ?? "");
    setComparisonSetupId(selected?.uploads.find((item) => item.setup_kind === "commercial")?.id ?? "");
    setCompareResult(null);
  }, [context, selected?.uploads]);

  async function uploadSetup(file: File, setupKind: "commercial" | "fixed" | "open" | "unknown" = "commercial") {
    if (!selected) return;
    setUploading(true); setMessage("Enviando setup para o cofre privado...");
    try {
      const form = new FormData(); form.set("file", file); form.set("carId", String(selected.car.id)); form.set("trackId", String(selected.track.id)); form.set("setupKind", setupKind);
      const response = await fetch("/api/setup/inventory", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no upload");
      setMessage(`${file.name} armazenado com segurança.`); setActiveSetupId(result.setup.id); loadInventory(); return result.setup;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  }

  async function compareSetups() {
    if (!selected) return;
    setComparing(true); setCompareResult(null); setMessage("Decodificando e comparando os setups...");
    try {
      const response = await fetch("/api/setup/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseSetupId, comparisonSetupId, carId: selected.car.id, trackId: selected.track.id, consent: decodeConsent }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Erro no comparativo");
      setCompareResult(result); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setComparing(false); }
  }

  async function runEngineer() {
    if (!selected || !activeSetupId) { setMessage("Anexe ou selecione um setup antes de analisar."); return; }
    setAnalyzing(true); setEngineerResult(null); setMessage("Analisando seu feedback e preparando um plano de testes...");
    try {
      const response = await fetch("/api/setup/engineer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupId: activeSetupId, carId: selected.car.id, trackId: selected.track.id, feedback }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Erro na análise");
      setEngineerResult(result); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setAnalyzing(false); }
  }

  return (
    <section className="setup-lab">
      <div className="setup-intro">
        <div><span className="section-kicker">SETUP LAB</span><h2>Seu engenheiro de pista</h2><p>{seasonName || "Season atual"} • todos os carros e pistas com corridas registradas.</p></div>
        <label className="setup-context"><span>CARRO + PISTA DA SEASON</span><select value={context} onChange={(event) => setContext(event.target.value)}>{contexts.map((item) => <option key={item.key} value={item.key}>{item.car.name} — {item.track.name}{item.track.variant ? ` (${item.track.variant})` : ""}</option>)}</select></label>
      </div>
      {message && <div className="status-banner">{message}</div>}

      <article className="panel local-library">
        <div className="panel-heading"><div><span className="section-kicker">BIBLIOTECA LOCAL PRIVADA</span><h3><FolderSearch size={18} /> Setups encontrados neste PC</h3><p>{library.total} arquivos da temporada atual • {new Set(library.items.map((item) => item.carFolder)).size} carros • última importação {library.importedAt ? new Date(library.importedAt).toLocaleString("pt-BR") : "pendente"}</p></div></div>
        <div className="library-groups">{[...new Set(library.items.map((item) => item.carFolder))].map((car) => { const items = library.items.filter((item) => item.carFolder === car); return <div key={car}><strong>{car}</strong><span>{items.length} setups • {[...new Set(items.map((item) => item.provider))].join(", ")}</span><small>{[...new Set(items.map((item) => item.track))].filter((track) => track !== "Não identificado").join(" • ") || "setup ativo do simulador"}</small></div>; })}</div>
        <p className="setup-guardrail">Arquivos comerciais ficam no bucket privado e nunca são publicados. Os setups padrão internos do iRacing ficam empacotados no simulador; a biblioteca inclui fixed exportado e o último setup carregado de cada carro ativo.</p>
      </article>

      <div className="setup-subtabs">
        <button className={mode === "generator" ? "active" : ""} onClick={() => setMode("generator")}><SlidersHorizontal size={16} />Gerador de setup</button>
        <button className={mode === "engineer" ? "active" : ""} onClick={() => setMode("engineer")}><Bot size={16} />Engenheiro</button>
      </div>

      {mode === "generator" ? (
        <><div className="setup-grid">
          <article className="panel setup-card"><span className="step-number">01 • FIXED</span><h3>Setup base do iRacing</h3><p>Selecione ou envie o fixed usado neste carro e pista.</p>{selected?.uploads.length ? <select className="setup-file-select" value={baseSetupId} onChange={(event) => setBaseSetupId(event.target.value)}><option value="">Selecionar setup base</option>{selected.uploads.map((file) => <option key={file.id} value={file.id}>{file.filename}</option>)}</select> : null}<label className={`setup-drop compact ${uploading ? "disabled" : ""}`}><FileUp size={20} /><strong>Enviar fixed .sto</strong><input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const saved = await uploadSetup(file, "fixed"); if (saved) setBaseSetupId(saved.id); } event.target.value = ""; }} /></label></article>
          <article className="panel setup-card"><span className="step-number">02 • COMERCIAL</span><h3>Setup de comparação</h3><p>Selecione o TS ou outro setup comercial.</p>{selected?.uploads.length ? <select className="setup-file-select" value={comparisonSetupId} onChange={(event) => setComparisonSetupId(event.target.value)}><option value="">Selecionar setup comercial</option>{selected.uploads.map((file) => <option key={file.id} value={file.id}>{file.filename}</option>)}</select> : null}<label className={`setup-drop compact ${uploading ? "disabled" : ""}`}><FileUp size={20} /><strong>Enviar comercial .sto</strong><input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const saved = await uploadSetup(file, "commercial"); if (saved) setComparisonSetupId(saved.id); } event.target.value = ""; }} /></label></article>
          <article className="panel setup-card setup-output"><span className="step-number">03 • COMPARAR</span><h3>Diferenças e motivos</h3><label className="decoder-consent"><input type="checkbox" checked={decodeConsent} onChange={(event) => setDecodeConsent(event.target.checked)} /><span>Autorizo a decodificação quando o serviço estiver disponível. O arquivo original permanece privado.</span></label><button className="primary-button setup-compare-button" disabled={!baseSetupId || !comparisonSetupId || !decodeConsent || comparing} onClick={compareSetups}>{comparing ? "Comparando..." : "Comparar fixed × open"}</button><p className="setup-guardrail">O endpoint antigo do SetupDelta foi retirado (410). Agora o app preserva os arquivos e explica como habilitar o comparativo por exportação HTML, sem falhar silenciosamente.</p></article>
        </div>
        {compareResult && <div className="panel setup-diff"><div className="panel-heading"><div><span className="section-kicker">SETUP DIFF</span><h3>{compareResult.summary}</h3><p>{compareResult.totalParameters} parâmetros mapeados foram verificados.</p></div></div>{compareResult.changes.map((change) => <article key={`${change.tab}-${change.section}-${change.label}`}><div><span>{change.tab} • {change.section}</span><strong>{change.label}</strong></div><div className="setup-values"><del>{change.before}</del><b>→</b><ins>{change.after}</ins></div><p>{change.explanation}</p></article>)}</div>}</>
      ) : (
        <div className="engineer-layout">
          <article className="panel engineer-chat"><div className="engineer-message"><Bot size={18} /><div><strong>Engenheiro</strong><p>Conte o que o carro faz na entrada, meio e saída da curva. O plano sugere testes explicados e preserva o `.sto` original.</p></div></div>{selected?.uploads.length ? <label className="engineer-setup-select"><span>SETUP ATIVO</span><select value={activeSetupId} onChange={(event) => setActiveSetupId(event.target.value)}>{selected.uploads.map((setup) => <option key={setup.id} value={setup.id}>{setup.filename}</option>)}</select></label> : null}<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Ex.: traseira escapa ao soltar o freio na entrada; quero mais confiança sem perder rotação no miolo..." /><div className="engineer-actions"><label className={`secondary-button ${uploading ? "disabled" : ""}`}>{uploading ? "Enviando..." : "Anexar setup"}<input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadSetup(file, "commercial"); event.target.value = ""; }} /></label><button className="primary-button" disabled={analyzing || !activeSetupId} onClick={runEngineer}>{analyzing ? "Analisando..." : "Gerar recomendação"}</button></div>{engineerResult && <div className="engineer-result"><strong>{engineerResult.summary}</strong>{engineerResult.recommendations.map((item) => <article key={`${item.adjustment}-${item.direction}`}><h4>{item.adjustment}</h4><b>{item.direction}</b><p>{item.why}</p><small>Validar: {item.validate}</small></article>)}<p className="setup-guardrail">{engineerResult.limitation}</p></div>}</article>
          <aside className="panel engineer-context"><span className="section-kicker">CONTEXTO AUTOMÁTICO</span><h3>O que entra na análise</h3><ul><li>carro e pista da semana;</li><li>setup atual e padrão;</li><li>telemetria própria e referência ativa;</li><li>feedback de entrada, meio e saída;</li><li>efeito e risco de cada alteração.</li></ul></aside>
        </div>
      )}
    </section>
  );
}
