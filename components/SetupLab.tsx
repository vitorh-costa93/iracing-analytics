"use client";

import { useEffect, useState } from "react";
import { Bot, FileUp, FolderSearch, SlidersHorizontal } from "lucide-react";

type SetupContext = {
  key: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  races: number;
  garage61: { scanned: boolean; accessible: boolean; observedLaps: number };
  uploads: { id: string; filename: string; file_size: number; setup_kind: "commercial" | "fixed" | "open" | "unknown"; source: string; decoder: string | null; decoded_at: string | null; created_at: string }[];
};
type EngineerRecommendation = { adjustment: string; direction: string; why: string; validate: string; parameter: { label: string; current: string } | null };
type EngineerResult = { summary: string; limitation: string; hasDecodedParameters: boolean; recommendations: EngineerRecommendation[] };
type ConversationTurn = { role: "user"; text: string } | { role: "assistant"; result: EngineerResult };
type CompareChange = { tab: string; section: string; label: string; before: string; after: string; explanation: string; category: string; settable: boolean };
type CompareAnalysis = { topCategories: { category: string; label: string; count: number }[]; topContributors: { label: string; before: string; after: string; category: string }[] };
type CompareResult = { summary: string; totalParameters: number; skippedCount: number; changes: CompareChange[]; analysis: CompareAnalysis };
type LibraryItem = { carFolder: string; filename: string; provider: string; kind: string; condition: string; track: string; week: number | null; size: number; modifiedAt: string };

// 02/09/2026 P2 fix: "o Laboratory mostra slugs crus (acuraarx06gtp) em vez do nome real do carro" --
// carFolder is iRacing's own local setup-folder naming (lowercase, no spaces/punctuation), which is
// perfect for matching a filesystem path but reads as raw internal data everywhere else in the app,
// which otherwise always shows a real car name. No separate car-name table is fetched here -- the
// season's own contexts (already loaded for the picker above) already carry every real car name this
// driver has, so a folder slug is matched against those by normalizing both sides the same way, rather
// than adding a new lookup just for this one display.
function normalizeCarSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function carDisplayName(folder: string, contexts: SetupContext[]) {
  const target = normalizeCarSlug(folder);
  const match = contexts.find((item) => normalizeCarSlug(item.car.name) === target);
  return match?.car.name ?? folder;
}

export default function SetupLab() {
  const [mode, setMode] = useState<"analysis" | "engineer">("analysis");
  const [contexts, setContexts] = useState<SetupContext[]>([]);
  const [context, setContext] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeSetupId, setActiveSetupId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [showSetupPicker, setShowSetupPicker] = useState(false);
  const [baseSetupId, setBaseSetupId] = useState("");
  const [comparisonSetupId, setComparisonSetupId] = useState("");
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

  // There used to be a second effect here that re-fetched /api/setup/inventory with
  // ?carId=&trackId= whenever a not-yet-"scanned" context was selected, because that used to
  // trigger a live Garage61 lookup scoped to just that pair. It no longer does -- the route reads
  // only the already-synced `laps` table now, and doesn't even look at those query params anymore,
  // so a per-context refetch just re-asked the same question and got the same (still Supabase-only)
  // answer. Removed; loadInventory()'s one fetch already has everything for every context.

  const selected = contexts.find((item) => item.key === context) ?? null;
  const setupA = selected?.uploads.find((item) => item.id === baseSetupId) ?? null;
  const setupB = selected?.uploads.find((item) => item.id === comparisonSetupId) ?? null;

  useEffect(() => {
    setActiveSetupId((current) => selected?.uploads.some((item) => item.id === current) ? current : selected?.uploads[0]?.id ?? "");
    setConversation([]);
    const preferred = selected?.uploads.find((item) => /fixed/i.test(item.filename))?.id ?? selected?.uploads[0]?.id ?? "";
    setBaseSetupId(preferred);
    setComparisonSetupId(selected?.uploads.find((item) => item.id !== preferred)?.id ?? "");
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
      const response = await fetch("/api/setup/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseSetupId, comparisonSetupId, carId: selected.car.id, trackId: selected.track.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Erro no comparativo");
      setCompareResult(result); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setComparing(false); }
  }

  const mentionedSetupIds = selected ? [...feedback.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => selected.uploads.find((item) => item.filename === match[1])?.id).filter((id): id is string => !!id) : [];

  function insertSetupMention(filename: string) {
    setFeedback((current) => current.replace(/\/setup\s*$/i, `[[${filename}]] `));
    setShowSetupPicker(false);
  }

  async function runEngineer() {
    if (!selected) return;
    const primarySetupId = mentionedSetupIds[0] ?? activeSetupId;
    if (!primarySetupId) { setMessage("Anexe ou selecione um setup antes de analisar (ou mencione um com /setup)."); return; }
    const userText = feedback.trim();
    if (!userText) { setMessage("Escreva o que o carro está fazendo antes de gerar a recomendação."); return; }
    setAnalyzing(true); setMessage(null);
    setConversation((current) => [...current, { role: "user", text: userText }]);
    setFeedback("");
    try {
      const body: Record<string, unknown> = { setupId: primarySetupId, carId: selected.car.id, trackId: selected.track.id, feedback: userText };
      if (mentionedSetupIds.length >= 2) body.blendWithSetupId = mentionedSetupIds[1];
      const response = await fetch("/api/setup/engineer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Erro na análise");
      setConversation((current) => [...current, { role: "assistant", result }]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setAnalyzing(false); }
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
        <div className="library-groups">{[...new Set(library.items.map((item) => item.carFolder))].map((car) => { const items = library.items.filter((item) => item.carFolder === car); return <div key={car}><strong>{carDisplayName(car, contexts)}</strong><span>{items.length} setups • {[...new Set(items.map((item) => item.provider))].join(", ")}</span><small>{[...new Set(items.map((item) => item.track))].filter((track) => track !== "Não identificado").join(" • ") || "setup ativo do simulador"}</small></div>; })}</div>
        <p className="setup-guardrail">Arquivos comerciais ficam no bucket privado e nunca são publicados. Os setups padrão internos do iRacing ficam empacotados no simulador; a biblioteca inclui fixed exportado e o último setup carregado de cada carro ativo.</p>
      </article>

      <div className="setup-subtabs">
        <button className={mode === "analysis" ? "active" : ""} onClick={() => setMode("analysis")}><SlidersHorizontal size={16} />Análise de setup</button>
        <button className={mode === "engineer" ? "active" : ""} onClick={() => setMode("engineer")}><Bot size={16} />Engenheiro</button>
      </div>

      {mode === "analysis" && (
        <><div className="setup-grid">
          <article className="panel setup-card"><span className="step-number">01 • SETUP A</span><h3>Primeiro setup</h3><p>Selecione qualquer setup disponível para este carro e pista.</p>{selected?.uploads.length ? <select className="setup-file-select" value={baseSetupId} onChange={(event) => setBaseSetupId(event.target.value)}><option value="">Selecionar setup A</option>{selected.uploads.map((file) => <option key={file.id} value={file.id}>{file.filename} • {file.setup_kind}</option>)}</select> : null}<label className={`setup-drop compact ${uploading ? "disabled" : ""}`}><FileUp size={20} /><strong>Enviar setup .sto</strong><input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const saved = await uploadSetup(file, "unknown"); if (saved) setBaseSetupId(saved.id); } event.target.value = ""; }} /></label></article>
          <article className="panel setup-card"><span className="step-number">02 • SETUP B</span><h3>Segundo setup</h3><p>Compare fixed, open ou dois setups comerciais livremente.</p>{selected?.uploads.length ? <select className="setup-file-select" value={comparisonSetupId} onChange={(event) => setComparisonSetupId(event.target.value)}><option value="">Selecionar setup B</option>{selected.uploads.map((file) => <option key={file.id} value={file.id}>{file.filename} • {file.setup_kind}</option>)}</select> : null}<label className={`setup-drop compact ${uploading ? "disabled" : ""}`}><FileUp size={20} /><strong>Enviar setup .sto</strong><input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const saved = await uploadSetup(file, "unknown"); if (saved) setComparisonSetupId(saved.id); } event.target.value = ""; }} /></label></article>
          <article className="panel setup-card setup-output"><span className="step-number">03 • COMPARAR</span><h3>Diferenças e comportamento</h3><div className="setup-access available"><SlidersHorizontal size={20} /><div><strong>Parâmetros disponíveis</strong><span>O Garage61 já decodificou os setups usados nas suas corridas. Nenhum arquivo é enviado a um serviço externo.</span></div></div><button className="primary-button setup-compare-button" disabled={!baseSetupId || !comparisonSetupId || baseSetupId === comparisonSetupId || comparing} onClick={compareSetups}>{comparing ? "Comparando..." : "Comparar setups"}</button><p className="setup-guardrail">Cada diferença explica a direção do efeito, o benefício esperado e o compromisso envolvido.</p></article>
        </div>
        {compareResult && (
          <div className="panel setup-diff">
            <div className="panel-heading"><div><span className="section-kicker">SETUP DIFF</span><h3>{compareResult.changes.length} parâmetros com efeito prático diferem entre os setups.</h3><p>{compareResult.totalParameters} parâmetros mapeados foram verificados{compareResult.skippedCount ? ` • ${compareResult.skippedCount} sem regra de efeito específica foram omitidos` : ""}.</p></div></div>
            <div className="setup-summary">
              <div className="setup-comparison-head">
                <div><span>SETUP A</span><strong>{setupA?.filename ?? "Primeiro setup"}</strong></div>
                <div><span>SETUP B</span><strong>{setupB?.filename ?? "Segundo setup"}</strong></div>
              </div>
              <p className="setup-summary-text">{compareResult.summary}</p>
              {compareResult.analysis.topContributors.length > 0 && (
                <div className="setup-summary-contributors">
                  <span className="section-kicker">MAIORES CONTRIBUINTES</span>
                  <ul>{compareResult.analysis.topContributors.map((item) => <li key={item.label}><strong>{item.label.split(" • ").pop()}</strong> <small>Setup A</small> <del>{item.before}</del> <b>→</b> <small>Setup B</small> <ins>{item.after}</ins></li>)}</ul>
                </div>
              )}
              {compareResult.analysis.topCategories.length > 0 && (
                <div className="setup-summary-categories">{compareResult.analysis.topCategories.map((item) => <span key={item.category} className="performance-badge">{item.label}: {item.count}</span>)}</div>
              )}
            </div>
            {compareResult.changes.map((change) => <article key={`${change.tab}-${change.section}-${change.label}`}><div><span>{change.tab} • {change.section}{!change.settable && <em className="setup-readonly-tag"> • resultado, não ajustável</em>}</span><strong>{change.label}</strong></div><div className="setup-values"><span><small>Setup A</small><del>{change.before}</del></span><b>→</b><span><small>Setup B</small><ins>{change.after}</ins></span></div><p>{change.explanation}</p></article>)}
          </div>
        )}</>
      )}

      {mode === "engineer" && (
        <div className="engineer-layout">
          <article className="panel engineer-chat">
            <div className="engineer-message"><Bot size={18} /><div><strong>Engenheiro</strong><p>Conte o que o carro faz na entrada, meio e saída da curva, ou digite <code>/setup</code> pra mencionar dois setups e pedir um meio-termo entre eles. A conversa continua — cada mensagem nova leva em conta o contexto do carro e pista selecionados.</p></div></div>

            {conversation.length > 0 && (
              <div className="engineer-thread">
                {conversation.map((turn, index) => turn.role === "user" ? (
                  <div className="engineer-turn user" key={index}><span>VOCÊ</span><p>{turn.text.replace(/\[\[([^\]]+)\]\]/g, "「$1」")}</p></div>
                ) : (
                  <div className="engineer-turn assistant" key={index}>
                    <span>ENGENHEIRO</span>
                    <p className="engineer-turn-summary">{turn.result.summary}</p>
                    {turn.result.recommendations.map((item) => (
                      <article key={`${index}-${item.adjustment}-${item.direction}`}>
                        <h4>{item.adjustment}</h4><b>{item.direction}</b><p>{item.why}</p>
                        {item.parameter && <div className="engineer-parameter"><span>PARÂMETRO NO SEU SETUP</span><strong>{item.parameter.label}</strong><span>valor atual: {item.parameter.current}</span></div>}
                        <small>Validar: {item.validate}</small>
                      </article>
                    ))}
                    <p className="setup-guardrail">{turn.result.limitation}</p>
                  </div>
                ))}
              </div>
            )}

            {selected?.uploads.length ? <label className="engineer-setup-select"><span>SETUP ATIVO (usado se você não mencionar nenhum com /setup)</span><select value={activeSetupId} onChange={(event) => setActiveSetupId(event.target.value)}>{selected.uploads.map((setup) => <option key={setup.id} value={setup.id}>{setup.filename}</option>)}</select></label> : null}

            <div className="engineer-input-wrap">
              <textarea
                value={feedback}
                onChange={(event) => { const value = event.target.value; setFeedback(value); setShowSetupPicker(/\/setup\s*$/i.test(value)); }}
                placeholder="Ex.: traseira escapa ao soltar o freio na entrada; ou /setup pra comparar dois e pedir um meio-termo..."
              />
              {showSetupPicker && selected?.uploads.length ? (
                <div className="engineer-setup-picker">
                  {selected.uploads.map((setup) => <button type="button" key={setup.id} onClick={() => insertSetupMention(setup.filename)}>{setup.filename} <span>{setup.setup_kind}</span></button>)}
                </div>
              ) : null}
            </div>
            {mentionedSetupIds.length >= 2 && <p className="comparison-note">Modo meio-termo ativo: comparando os dois setups mencionados.</p>}

            <div className="engineer-actions">
              <label className={`secondary-button ${uploading ? "disabled" : ""}`}>{uploading ? "Enviando..." : "Anexar setup"}<input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadSetup(file, "commercial"); event.target.value = ""; }} /></label>
              <button className="primary-button" disabled={analyzing || (!activeSetupId && !mentionedSetupIds.length)} onClick={runEngineer}>{analyzing ? "Analisando..." : conversation.length ? "Enviar" : "Gerar recomendação"}</button>
            </div>
          </article>
          <aside className="panel engineer-context"><span className="section-kicker">CONTEXTO AUTOMÁTICO</span><h3>O que entra na análise</h3><ul><li>carro e pista da semana;</li><li>setup atual e padrão;</li><li>telemetria própria e referência ativa;</li><li>feedback de entrada, meio e saída;</li><li>efeito e risco de cada alteração.</li></ul></aside>
        </div>
      )}
    </section>
  );
}
