"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppTabs from "@/components/AppTabs";
import { Chip, PageTitle, SelectPill } from "@/components/ui";
import { latestProposal } from "@/lib/engineer-proposal";
import { setupDisplayName } from "@/lib/setup-names";
import { trackUiEvent } from "@/lib/track-ui-event";
import { EngineerChat } from "./EngineerChat";
import { ProposalPanel } from "./ProposalPanel";
import { SetupComparator } from "./SetupComparator";
import type { ChatMessage, CompareResult, LibraryItem, SetupContext } from "./types";

const PROPOSAL_VALUE = "__proposta__";
const STREAM_FAILED_MARK = "[Erro: conexão com a IA foi interrompida";

// iRacing nomeia a pasta local do carro sem espaços ("acuraarx06gtp"); /api/setup/library já resolve
// contra a tabela de carros, e os contextos da season são só o plano B (mesma regra da tela antiga).
function normalizeCarSlug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function carDisplayName(folder: string, contexts: SetupContext[], carNames: Record<string, string>) {
  if (carNames[folder]) return carNames[folder];
  const match = contexts.find((item) => normalizeCarSlug(item.car.name) === normalizeCarSlug(folder));
  return match?.car.name ?? folder;
}

function contextLabel(context: SetupContext) {
  return `${context.car.name} · ${context.track.name}${context.track.variant ? ` (${context.track.variant})` : ""}`;
}

export default function SetupLabView() {
  const [contexts, setContexts] = useState<SetupContext[]>([]);
  const [seasonName, setSeasonName] = useState("");
  const [contextKey, setContextKey] = useState("");
  const [activeValue, setActiveValue] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [comparisonId, setComparisonId] = useState("");
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ total: number; importedAt: string | null; items: LibraryItem[] }>({ total: 0, importedAt: null, items: [] });
  const [carNames, setCarNames] = useState<Record<string, string>>({});
  const compareCache = useRef(new Map<string, CompareResult>());
  // Mesmo cuidado da tela antiga: se o piloto trocar de carro/pista no meio do streaming, a resposta
  // pertence a outra conversa e não pode cair na que está na tela (ela já fica salva no servidor).
  const contextRef = useRef(contextKey);
  useEffect(() => { contextRef.current = contextKey; }, [contextKey]);

  const loadInventory = useCallback(() => {
    fetch("/api/setup/inventory", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.status !== "ok") throw new Error(data.message ?? "Erro ao carregar setups");
        const next = (data.contexts ?? []) as SetupContext[];
        setContexts(next);
        setSeasonName(data.season?.name ?? "");
        setContextKey((current) => (next.some((item) => item.key === current) ? current : next[0]?.key ?? ""));
        setLoadError(null);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    loadInventory();
    fetch("/api/setup/library", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.status === "ok") { setLibrary({ total: data.total ?? 0, importedAt: data.importedAt ?? null, items: data.items ?? [] }); setCarNames(data.carNames ?? {}); } })
      .catch(() => undefined);
  }, [loadInventory]);

  const selected = contexts.find((item) => item.key === contextKey) ?? null;
  const uploads = useMemo(() => selected?.uploads ?? [], [selected]);
  const proposal = useMemo(() => latestProposal(conversation), [conversation]);
  const onProposal = activeValue === PROPOSAL_VALUE && proposal !== null;
  const activeSetupId = onProposal ? proposal!.baseSetupId : activeValue;
  const activeSetup = uploads.find((item) => item.id === activeSetupId) ?? null;

  const loadThread = useCallback(async (context: SetupContext) => {
    const response = await fetch(`/api/setup/engineer/chat?carId=${context.car.id}&trackId=${context.track.id}`, { cache: "no-store" });
    const data = await response.json();
    return data.status === "ok" ? (data.messages as ChatMessage[]) : [];
  }, []);

  // Troca de carro/pista: carrega a conversa salva e escolhe setups padrão (o do último turno do piloto,
  // senão o primeiro fixed, senão o primeiro da lista).
  useEffect(() => {
    let cancelled = false;
    setCompareResult(null); setCompareError(null); setNotice(null);
    if (!selected) { setConversation([]); setActiveValue(""); return; }
    const preferred = selected.uploads.find((item) => item.setup_kind === "fixed")?.id ?? selected.uploads[0]?.id ?? "";
    setActiveValue(preferred);
    setBaseId(preferred);
    setComparisonId(selected.uploads.find((item) => item.id !== preferred)?.id ?? "");
    setLoadingThread(true);
    loadThread(selected)
      .then((messages) => {
        if (cancelled) return;
        setConversation(messages);
        const lastUser = [...messages].reverse().find((message) => message.role === "user" && message.setupId);
        if (lastUser?.setupId && selected.uploads.some((item) => item.id === lastUser.setupId)) {
          setActiveValue(lastUser.onProposal && latestProposal(messages)?.baseSetupId === lastUser.setupId ? PROPOSAL_VALUE : lastUser.setupId);
        }
      })
      .catch(() => { if (!cancelled) setConversation([]); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    return () => { cancelled = true; };
    // selected muda de identidade a cada recarga do inventário; a chave e a lista de setups bastam.
  }, [contextKey, selected?.uploads, loadThread]);

  async function send(text: string | null, mentions: Array<{ id: string; name: string }> = []): Promise<boolean> {
    if (!selected) return false;
    const sentFor = contextKey;
    setAnalyzing(true); setNotice(null);
    if (text) setConversation((current) => [...current, { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString(), mentions }]);
    setStreamingText("");
    try {
      const body: Record<string, unknown> = { carId: selected.car.id, trackId: selected.track.id, carName: selected.car.name, trackName: selected.track.name };
      if (text) {
        body.message = text;
        if (activeSetupId) body.setupId = activeSetupId;
        if (onProposal) body.useProposal = true;
        if (mentions.length) body.mentionIds = mentions.map((item) => item.id);
      } else {
        body.regenerate = true;
        if (activeSetupId) body.setupId = activeSetupId;
      }
      const response = await fetch("/api/setup/engineer/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok || !response.body) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message ?? "Erro ao falar com o engenheiro");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assembled += decoder.decode(value, { stream: true });
        if (contextRef.current === sentFor) setStreamingText(assembled);
      }
      if (contextRef.current !== sentFor) return true;
      if (assembled.includes(STREAM_FAILED_MARK)) {
        // O servidor não grava turno interrompido; o cliente também não fica com ele.
        if (text) setConversation((current) => current.slice(0, -1));
        setNotice("A resposta do engenheiro foi interrompida antes de terminar. Tente de novo.");
        return false;
      }
      // A versão salva traz a proposta já resolvida (valores A → B); se a releitura falhar, fica o texto.
      try {
        const saved = await loadThread(selected);
        if (contextRef.current === sentFor) setConversation(saved);
      } catch {
        setConversation((current) => (text ? current : current.slice(0, -1)).concat({ id: crypto.randomUUID(), role: "assistant", content: assembled, createdAt: new Date().toISOString() }));
      }
      trackUiEvent("setup_engineer_recommendation_requested", { carId: selected.car.id, trackId: selected.track.id });
      return true;
    } catch (error) {
      if (contextRef.current === sentFor) {
        if (text) setConversation((current) => current.slice(0, -1));
        setNotice(error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      setStreamingText(null);
      setAnalyzing(false);
    }
  }

  async function resetConversation() {
    if (!selected) return;
    if (!window.confirm(`Apagar a conversa de ${selected.car.name} em ${selected.track.name} e começar do zero?`)) return;
    const response = await fetch(`/api/setup/engineer/chat?carId=${selected.car.id}&trackId=${selected.track.id}`, { method: "DELETE" });
    if (response.ok) { setConversation([]); setActiveValue((current) => (current === PROPOSAL_VALUE ? proposal?.baseSetupId ?? "" : current)); }
    else setNotice("Não consegui apagar a conversa. Tente de novo.");
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setNotice("Resposta copiada.")).catch(() => setNotice("Não foi possível copiar."));
  }

  async function uploadSetup(file: File) {
    if (!selected) return;
    setUploading(true); setNotice("Guardando o setup no cofre privado…");
    try {
      const form = new FormData();
      form.set("file", file); form.set("carId", String(selected.car.id)); form.set("trackId", String(selected.track.id)); form.set("setupKind", "commercial");
      const response = await fetch("/api/setup/inventory", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no envio");
      setNotice(`${setupDisplayName(file.name)} guardado. Ele entra na análise quando o Garage61 ler os parâmetros de uma sessão com ele.`);
      loadInventory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }

  async function runCompare() {
    if (!selected || !baseId || !comparisonId || baseId === comparisonId) return;
    const cacheKey = `${baseId}:${comparisonId}`;
    const cached = compareCache.current.get(cacheKey);
    if (cached) { setCompareResult(cached); setCompareError(null); return; }
    setComparing(true); setCompareError(null);
    try {
      const response = await fetch("/api/setup/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseSetupId: baseId, comparisonSetupId: comparisonId, carId: selected.car.id, trackId: selected.track.id }) });
      const result = await response.json();
      if (!response.ok || result.status !== "ok") throw new Error(result.message ?? "Erro na comparação");
      compareCache.current.set(cacheKey, result as CompareResult);
      setCompareResult(result as CompareResult);
      trackUiEvent("setup_comparison_completed", { carId: selected.car.id, trackId: selected.track.id });
    } catch (error) {
      setCompareResult(null);
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setComparing(false);
    }
  }

  const contextOptions = contexts.map((item) => ({ value: item.key, label: contextLabel(item) }));
  const setupOptions = [
    ...(uploads.length ? [] : [{ value: "", label: "Nenhum setup lido ainda" }]),
    ...(proposal && uploads.some((item) => item.id === proposal.baseSetupId) ? [{ value: PROPOSAL_VALUE, label: `B · ${proposal.baseName} (proposta)` }] : []),
    ...uploads.map((item) => ({ value: item.id, label: setupDisplayName(item.filename) })),
  ];
  const seasonShort = seasonName.replace(/^\d{4}\s+/, "");
  const brand = selected?.car.name.split(" - ")[0].split(" ").slice(0, 2).join(" ") ?? "";
  const libraryCars = [...new Set(library.items.map((item) => item.carFolder))];

  return (
    <div className="ng-page">
      <main className="ng-main ngs-main">
        <PageTitle eyebrow="Setup Lab" title="Seu engenheiro de pista" />
        {loadError && <div className="ngs-banner" data-tone="loss">{loadError}</div>}

        <div className="ngs-selectors">
          <span className="ngs-selector-label">CARRO E PISTA</span>
          <SelectPill ariaLabel="Carro e pista" options={contextOptions.length ? contextOptions : [{ value: "", label: "Carregando…" }]} value={contextKey} onChange={(value) => setContextKey(value)} className="ngs-select-context" />
          <span className="ngs-selector-label ngs-selector-gap">SETUP ATIVO</span>
          <SelectPill ariaLabel="Setup ativo" options={setupOptions} value={activeValue} onChange={(value) => setActiveValue(value)} disabled={!uploads.length} className="ngs-select-setup" />
          <div className="ngs-grow" />
          {selected && <Chip>{conversation.length ? "conversa salva" : "conversa nova"} · {seasonShort || "season atual"} · {brand} · {selected.track.name}</Chip>}
          <Chip>.sto original nunca é reescrito</Chip>
        </div>

        {notice && (
          <div className="ngs-banner"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Fechar</button></div>
        )}

        <div className="ngs-grid">
          <EngineerChat
            key={contextKey}
            messages={conversation}
            streamingText={streamingText}
            analyzing={analyzing}
            loading={loadingThread}
            setups={uploads}
            activeSetupId={activeSetupId}
            canChat={Boolean(selected)}
            onSend={(text, mentions) => send(text, mentions)}
            onRegenerate={() => void send(null)}
            onReset={() => void resetConversation()}
            onCopy={copy}
            onSymptom={() => trackUiEvent("setup_engineer_prompt_selected", { carId: selected?.car.id, trackId: selected?.track.id })}
          />
          <ProposalPanel proposal={proposal} activeName={activeSetup ? setupDisplayName(activeSetup.filename) : null} activeSetupId={activeSetupId} />
        </div>

        <SetupComparator
          setups={uploads}
          baseId={baseId}
          comparisonId={comparisonId}
          onBase={(id) => { setBaseId(id); setCompareResult(null); setCompareError(null); }}
          onComparison={(id) => { setComparisonId(id); setCompareResult(null); setCompareError(null); }}
          onRun={() => void runCompare()}
          running={comparing}
          result={compareResult}
          error={compareError}
        />

        {/* Recursos que o mockup não redesenha, mantidos de forma discreta: biblioteca local privada,
            envio de .sto para o cofre e os favoritos de importação (Garage61/iRStats). */}
        <details className="ngs-extras">
          <summary>Biblioteca local, anexar setup e importação</summary>
          <div className="ngs-extras-body">
            <div>
              <div className="ngs-extras-title">Biblioteca local privada</div>
              <p>{library.total} arquivos da season atual · {libraryCars.length} carros · última importação {library.importedAt ? new Date(library.importedAt).toLocaleString("pt-BR") : "pendente"}</p>
              <ul className="ngs-library">
                {libraryCars.map((car) => {
                  const items = library.items.filter((item) => item.carFolder === car);
                  const tracks = [...new Set(items.map((item) => item.track))].filter((track) => track !== "Não identificado");
                  return <li key={car}><strong>{carDisplayName(car, contexts, carNames)}</strong> · {items.length} setups · {[...new Set(items.map((item) => item.provider))].join(", ")}{tracks.length ? ` · ${tracks.join(", ")}` : ""}</li>;
                })}
              </ul>
            </div>
            <div>
              <div className="ngs-extras-title">Anexar setup .sto</div>
              <p>O arquivo vai para o cofre privado, nunca é publicado nem reescrito. A comparação usa os parâmetros que o Garage61 leu das suas sessões com ele.</p>
              <label className="ngs-upload" data-disabled={uploading || !selected ? "" : undefined}>
                {uploading ? "Enviando…" : "Escolher arquivo .sto"}
                <input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSetup(file); event.target.value = ""; }} />
              </label>
            </div>
            <div>
              <div className="ngs-extras-title">Importar setups do Garage61</div>
              <p>Use o favorito de importação na página do Garage61, já logado.</p>
              <AppTabs />
            </div>
          </div>
        </details>
      </main>
    </div>
  );
}
