"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Panel } from "@/components/ui";
import { splitEngineerText, type ResolvedProposal } from "@/lib/engineer-proposal";
import { setupDisplayName, setupSourceLabel } from "@/lib/setup-names";
import type { ChatMessage, SetupUpload } from "./types";

export const SYMPTOM_CHIPS = ["Subesterça na entrada", "Traseira solta na saída", "Instável na frenagem", "Sem tração na saída"];
const MAX_MENTIONS = 2;

type Mention = { id: string; name: string };

/** "/" no começo de uma palavra, no fim do texto: abre o menu de setups. Devolve o termo digitado. */
export function slashQuery(text: string): string | null {
  const match = text.match(/(?:^|\s)\/([^\s/]*(?: [^\s/]*)?)$/);
  if (!match) return null;
  return match[1].replace(/^setup\s*/i, "");
}

function ProposalBox({ proposal }: { proposal: ResolvedProposal }) {
  if (!proposal.changes.length) return null;
  return (
    <div className="ngs-proposal-box">
      <div className="ngs-proposal-box-title">MUDANÇA SUGERIDA · SETUP B</div>
      {proposal.changes.map((change) => (
        <div key={change.key} className="ngs-proposal-box-row"><span>{change.hint ?? change.name}</span><span>{change.a} → {change.b}</span></div>
      ))}
    </div>
  );
}

function UserText({ message }: { message: ChatMessage }) {
  const names = (message.mentions ?? []).map((item) => item.name).filter(Boolean);
  if (!names.length) return <>{message.content}</>;
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const parts = message.content.split(new RegExp(`(/setup (?:${escaped.join("|")}))`, "g"));
  return <>{parts.map((part, index) => (part.startsWith("/setup ") ? <span key={index} className="ngs-mention-text">{part}</span> : <Fragment key={index}>{part}</Fragment>))}</>;
}

export function EngineerChat({
  messages, streamingText, analyzing, loading, setups, activeSetupId, canChat, onSend, onRegenerate, onReset, onCopy, onSymptom, headActions,
}: {
  messages: ChatMessage[];
  streamingText: string | null;
  analyzing: boolean;
  loading: boolean;
  setups: SetupUpload[];
  activeSetupId: string;
  canChat: boolean;
  onSend: (text: string, mentions: Mention[]) => Promise<boolean>;
  onRegenerate: () => void;
  onReset: () => void;
  onCopy: (text: string) => void;
  onSymptom?: () => void;
  headActions?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const query = slashQuery(draft);
  const options = useMemo(() => {
    if (query === null) return [];
    const needle = query.trim().toLowerCase();
    return setups
      .map((setup) => ({ id: setup.id, name: setupDisplayName(setup.filename), source: setupSourceLabel(setup.source), active: setup.id === activeSetupId }))
      .filter((option) => !needle || option.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [query, setups, activeSetupId]);
  const menuOpen = !menuClosed && query !== null && options.length > 0;

  useEffect(() => { setMenuIndex(0); }, [query]);
  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streamingText]);
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
  }, [draft]);

  function pick(option: { id: string; name: string }) {
    setDraft((current) => current.replace(/(^|\s)\/([^\s/]*(?: [^\s/]*)?)$/, `$1/setup ${option.name} `));
    setMentions((current) => (current.some((item) => item.id === option.id) ? current : [...current, { id: option.id, name: option.name }].slice(-MAX_MENTIONS)));
    inputRef.current?.focus();
  }

  async function send() {
    const text = draft.trim();
    if (!text || analyzing || !canChat) return;
    // Só conta como citado o setup cujo "/setup Nome" ainda está no texto.
    const cited = mentions.filter((item) => text.includes(`/setup ${item.name}`));
    const previousDraft = draft, previousMentions = mentions;
    setDraft(""); setMentions([]);
    const ok = await onSend(text, cited);
    if (!ok) { setDraft(previousDraft); setMentions(previousMentions); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMenuIndex((index) => (index + 1) % options.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMenuIndex((index) => (index - 1 + options.length) % options.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(options[menuIndex]); return; }
      if (event.key === "Escape") { event.preventDefault(); setMenuClosed(true); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  const lastId = messages[messages.length - 1]?.id;
  const streamingVisible = streamingText === null ? null : splitEngineerText(streamingText).visible;

  return (
    <Panel
      as="section"
      className="ngs-chat"
      kicker="ENGENHEIRO"
      title="Converse sobre o carro"
      subtitle="A conversa fica salva por pista, carro e season · digite / para citar um setup"
      actions={<div className="ngs-head-actions">{headActions}{messages.length > 0 && <button type="button" className="ngs-ghost" onClick={onReset} disabled={analyzing}>Nova conversa</button>}</div>}
    >
      <div className="ngs-thread" ref={threadRef} aria-live="polite">
        {loading && <div className="ngs-empty">Carregando a conversa…</div>}
        {!loading && messages.length === 0 && streamingText === null && (
          <div className="ngs-empty">
            {canChat
              ? "Conte o que o carro está fazendo: em que curva, e se é na freada, no meio ou na saída. Eu sugiro uma mudança por vez no setup ativo."
              : "Escolha um carro e pista da season para conversar."}
          </div>
        )}
        {messages.map((message) => message.role === "user" ? (
          <div key={message.id} className="ngs-bubble" data-role="user"><UserText message={message} /></div>
        ) : (
          <div key={message.id} className="ngs-bubble-wrap">
            <div className="ngs-bubble" data-role="engineer">
              <div className="ngs-bubble-kicker">ENGENHEIRO</div>
              <div className="ngs-markdown"><ReactMarkdown>{splitEngineerText(message.content).visible}</ReactMarkdown></div>
              {message.proposal && <ProposalBox proposal={message.proposal} />}
            </div>
            <div className="ngs-bubble-actions">
              <button type="button" onClick={() => onCopy(splitEngineerText(message.content).visible)}>Copiar</button>
              {message.id === lastId && <button type="button" onClick={onRegenerate} disabled={analyzing}>Regenerar</button>}
            </div>
          </div>
        ))}
        {streamingVisible !== null && (
          <div className="ngs-bubble" data-role="engineer" data-streaming="">
            <div className="ngs-bubble-kicker">ENGENHEIRO</div>
            <div className="ngs-markdown">{streamingVisible ? <ReactMarkdown>{streamingVisible}</ReactMarkdown> : <span className="ngs-typing">pensando…</span>}</div>
          </div>
        )}
      </div>

      <div className="ngs-composer">
        {menuOpen && (
          <div className="ngs-slash-menu" role="listbox" aria-label="Setups deste carro">
            {options.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={index === menuIndex}
                onMouseDown={(event) => { event.preventDefault(); pick(option); }}
                onMouseEnter={() => setMenuIndex(index)}
              >
                <span className="ngs-slash-name">/setup {option.name}</span>
                <span className="ngs-slash-source">{option.source}{option.active ? " · atual" : ""}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ngs-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={!canChat}
            maxLength={4000}
            aria-label="Mensagem para o engenheiro"
            placeholder="Conte o que o carro está fazendo… /"
            onChange={(event) => { setDraft(event.target.value); setMenuClosed(false); }}
            onKeyDown={onKeyDown}
          />
          {mentions.map((item) => (
            <button key={item.id} type="button" className="ngs-mention-chip" title="Tirar a citação" onClick={() => setMentions((current) => current.filter((mention) => mention.id !== item.id))}>@ {item.name}</button>
          ))}
          <button type="button" className="ng-button ngs-send" disabled={!draft.trim() || analyzing || !canChat} onClick={() => void send()}>{analyzing ? "Enviando…" : "Enviar"}</button>
        </div>
        <div className="ngs-symptoms">
          {SYMPTOM_CHIPS.map((symptom) => (
            <button key={symptom} type="button" className="ngs-symptom" disabled={!canChat} onClick={() => { setDraft(symptom); setMenuClosed(true); onSymptom?.(); inputRef.current?.focus(); }}>{symptom}</button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
