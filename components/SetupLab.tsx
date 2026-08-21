"use client";

import { useEffect, useState } from "react";
import { Bot, FileUp, FolderSearch, SlidersHorizontal, Wand2 } from "lucide-react";

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
type CompareChange = { tab: string; section: string; label: string; before: string; after: string; explanation: string; category: string };
type CompareAnalysis = { topCategories: { category: string; label: string; count: number }[]; topContributors: { label: string; before: string; after: string; category: string }[] };
type CompareResult = { summary: string; totalParameters: number; skippedCount: number; changes: CompareChange[]; analysis: CompareAnalysis };
type LibraryItem = { carFolder: string; filename: string; provider: string; kind: string; condition: string; track: string; week: number | null; size: number; modifiedAt: string };
type PatternParam = { tab: string; section: string; label: string; category: string; categoryLabel: string; occurrences: number; tracksAnalyzed: number; coveragePct: number; direction: "increase" | "decrease" | "mixed" | "enum"; consistencyPct: number | null; examples: { track: string; before: string; after: string }[] };
type PatternsResult = {
  cars: { carId: number; carName: string; pairedTracks: number; totalSetups: number }[];
  selected: { carId: number; carName: string; tracksAnalyzed: number; trackPairs: { trackId: number; trackName: string; fixedFile: string; comparisonFile: string; comparisonKind: string }[]; parameters: PatternParam[]; strongPatternsCount: number } | null;
};

const DIRECTION_LABEL: Record<PatternParam["direction"], string> = { increase: "sempre aumenta", decrease: "sempre reduz", mixed: "varia por pista", enum: "muda de forma não numérica" };

export default function SetupLab() {
  const [mode, setMode] = useState<"analysis" | "generator" | "engineer">("analysis");
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
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [library, setLibrary] = useState<{ total: number; importedAt: string | null; items: LibraryItem[] }>({ total: 0, importedAt: null, items: [] });
  const [patterns, setPatterns] = useState<PatternsResult | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsCarId, setPatternsCarId] = useState<number | null>(null);

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
    if (mode !== "generator") return;
    setPatternsLoading(true);
    const query = patternsCarId ? `?carId=${patternsCarId}` : "";
    fetch(`/api/setup/patterns${query}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.status !== "ok") throw new Error(data.message ?? "Erro ao analisar padrões");
        setPatterns(data);
        if (!patternsCarId && data.selected) setPatternsCarId(data.selected.carId);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setPatternsLoading(false));
  }, [mode, patternsCarId]);

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
        <button className={mode === "analysis" ? "active" : ""} onClick={() => setMode("analysis")}><SlidersHorizontal size={16} />Análise de setup</button>
        <button className={mode === "generator" ? "active" : ""} onClick={() => setMode("generator")}><Wand2 size={16} />Gerador de Setup</button>
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
              <p>{compareResult.summary}</p>
              {compareResult.analysis.topContributors.length > 0 && (
                <div className="setup-summary-contributors">
                  <span className="section-kicker">MAIORES CONTRIBUINTES</span>
                  <ul>{compareResult.analysis.topContributors.map((item) => <li key={item.label}><strong>{item.label.split(" • ").pop()}</strong> <del>{item.before}</del> → <ins>{item.after}</ins></li>)}</ul>
                </div>
              )}
              {compareResult.analysis.topCategories.length > 0 && (
                <div className="setup-summary-categories">{compareResult.analysis.topCategories.map((item) => <span key={item.category} className="performance-badge">{item.label}: {item.count}</span>)}</div>
              )}
            </div>
            {compareResult.changes.map((change) => <article key={`${change.tab}-${change.section}-${change.label}`}><div><span>{change.tab} • {change.section}</span><strong>{change.label}</strong></div><div className="setup-values"><del>{change.before}</del><b>→</b><ins>{change.after}</ins></div><p>{change.explanation}</p></article>)}
          </div>
        )}</>
      )}

      {mode === "generator" && (
        <div className="panel setup-patterns">
          <div className="panel-heading">
            <div><span className="section-kicker">GERADOR DE SETUP</span><h3>Padrões entre setups fixed e comerciais</h3><p>Compara, pista a pista, o que os setups comerciais mudam em relação ao fixed do mesmo carro — para você entender a receita e um dia montar o seu.</p></div>
            {patterns && patterns.cars.length > 1 && (
              <select className="setup-file-select" value={patternsCarId ?? ""} onChange={(event) => setPatternsCarId(Number(event.target.value))}>
                {patterns.cars.map((car) => <option key={car.carId} value={car.carId}>{car.carName} ({car.pairedTracks} pistas)</option>)}
              </select>
            )}
          </div>
          {patternsLoading && <p className="comparison-note">Comparando setups fixed × comerciais em todas as pistas disponíveis...</p>}
          {!patternsLoading && patterns && !patterns.selected && <p className="comparison-note">Ainda não há setups fixed e comerciais decodificados (via Garage61) da mesma pista para comparar. Use o carro nas corridas para o Garage61 capturar os parâmetros.</p>}
          {!patternsLoading && patterns?.selected && (
            <>
              <p className="setup-patterns-meta">{patterns.selected.carName} • {patterns.selected.tracksAnalyzed} pista(s) comparadas • {patterns.selected.strongPatternsCount} padrão(ões) consistente(s) encontrados.</p>
              <div className="setup-patterns-list">
                {patterns.selected.parameters.map((param) => (
                  <article key={`${param.tab}-${param.section}-${param.label}`} className={`setup-pattern-card ${param.direction}`}>
                    <div className="setup-pattern-head">
                      <div><span>{param.tab} • {param.section}</span><strong>{param.label}</strong></div>
                      <span className="performance-badge">{param.categoryLabel}</span>
                    </div>
                    <p className="setup-pattern-summary">
                      {param.direction === "mixed" ? "Muda de forma inconsistente entre pistas — não parece ser uma regra fixa do preparador." :
                       param.direction === "enum" ? `Muda em ${param.occurrences} de ${param.tracksAnalyzed} pistas (${param.coveragePct}%), mas não é um valor numérico direto — compare os exemplos.` :
                       `${DIRECTION_LABEL[param.direction]} no comercial em relação ao fixed, em ${param.occurrences} de ${param.tracksAnalyzed} pistas analisadas (${param.consistencyPct}% de consistência, presente em ${param.coveragePct}% das pistas).`}
                    </p>
                    <div className="setup-pattern-examples">{param.examples.map((example) => <span key={example.track}>{example.track}: <del>{example.before}</del> → <ins>{example.after}</ins></span>)}</div>
                  </article>
                ))}
                {!patterns.selected.parameters.length && <p className="comparison-note">Nenhuma diferença com efeito prático encontrada entre os setups fixed e comerciais deste carro.</p>}
              </div>
            </>
          )}
        </div>
      )}

      {mode === "engineer" && (
        <div className="engineer-layout">
          <article className="panel engineer-chat"><div className="engineer-message"><Bot size={18} /><div><strong>Engenheiro</strong><p>Conte o que o carro faz na entrada, meio e saída da curva. O plano sugere testes explicados e preserva o `.sto` original.</p></div></div>{selected?.uploads.length ? <label className="engineer-setup-select"><span>SETUP ATIVO</span><select value={activeSetupId} onChange={(event) => setActiveSetupId(event.target.value)}>{selected.uploads.map((setup) => <option key={setup.id} value={setup.id}>{setup.filename}</option>)}</select></label> : null}<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Ex.: traseira escapa ao soltar o freio na entrada; quero mais confiança sem perder rotação no miolo..." /><div className="engineer-actions"><label className={`secondary-button ${uploading ? "disabled" : ""}`}>{uploading ? "Enviando..." : "Anexar setup"}<input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadSetup(file, "commercial"); event.target.value = ""; }} /></label><button className="primary-button" disabled={analyzing || !activeSetupId} onClick={runEngineer}>{analyzing ? "Analisando..." : "Gerar recomendação"}</button></div>{engineerResult && <div className="engineer-result"><strong>{engineerResult.summary}</strong>{engineerResult.recommendations.map((item) => <article key={`${item.adjustment}-${item.direction}`}><h4>{item.adjustment}</h4><b>{item.direction}</b><p>{item.why}</p>{item.parameter && <div className="engineer-parameter"><span>PARÂMETRO NO SEU SETUP</span><strong>{item.parameter.label}</strong><span>valor atual: {item.parameter.current}</span></div>}<small>Validar: {item.validate}</small></article>)}<p className="setup-guardrail">{engineerResult.limitation}</p></div>}</article>
          <aside className="panel engineer-context"><span className="section-kicker">CONTEXTO AUTOMÁTICO</span><h3>O que entra na análise</h3><ul><li>carro e pista da semana;</li><li>setup atual e padrão;</li><li>telemetria própria e referência ativa;</li><li>feedback de entrada, meio e saída;</li><li>efeito e risco de cada alteração.</li></ul></aside>
        </div>
      )}
    </section>
  );
}
