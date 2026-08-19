"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, FileLock2, FileUp, SlidersHorizontal } from "lucide-react";

type SetupContext = {
  key: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  races: number;
  garage61: { accessible: boolean; blockedCommercialDetected: boolean; observedLaps: number };
  uploads: { id: string; filename: string; file_size: number; created_at: string }[];
};

export default function SetupLab() {
  const [mode, setMode] = useState<"generator" | "engineer">("generator");
  const [contexts, setContexts] = useState<SetupContext[]>([]);
  const [context, setContext] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
  }, []);

  const selected = contexts.find((item) => item.key === context) ?? null;

  async function uploadCommercial(file: File) {
    if (!selected) return;
    setUploading(true); setMessage("Enviando setup para o cofre privado...");
    try {
      const form = new FormData(); form.set("file", file); form.set("carId", String(selected.car.id)); form.set("trackId", String(selected.track.id));
      const response = await fetch("/api/setup/inventory", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no upload");
      setMessage(`${file.name} armazenado com segurança.`); loadInventory();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  }

  return (
    <section className="setup-lab">
      <div className="setup-intro">
        <div><span className="section-kicker">SETUP LAB</span><h2>Seu engenheiro de pista</h2><p>{seasonName || "Season atual"} • todos os carros e pistas com corridas registradas.</p></div>
        <label className="setup-context"><span>CARRO + PISTA DA SEASON</span><select value={context} onChange={(event) => setContext(event.target.value)}>{contexts.map((item) => <option key={item.key} value={item.key}>{item.car.name} — {item.track.name}{item.track.variant ? ` (${item.track.variant})` : ""}</option>)}</select></label>
      </div>
      {message && <div className="status-banner">{message}</div>}

      <div className="setup-subtabs">
        <button className={mode === "generator" ? "active" : ""} onClick={() => setMode("generator")}><SlidersHorizontal size={16} />Gerador de setup</button>
        <button className={mode === "engineer" ? "active" : ""} onClick={() => setMode("engineer")}><Bot size={16} />Engenheiro</button>
      </div>

      {mode === "generator" ? (
        <div className="setup-grid">
          <article className="panel setup-card"><span className="step-number">01 • GARAGE61</span><h3>Descoberta automática</h3><p>{selected ? `${selected.races} corrida(s) e ${selected.garage61.observedLaps} volta(s) catalogada(s) neste contexto.` : "Selecione um contexto."}</p><div className={`setup-access ${selected?.garage61.accessible ? "available" : "blocked"}`}>{selected?.garage61.accessible ? <CheckCircle2 /> : <FileLock2 />}<div><strong>{selected?.garage61.accessible ? "Setup visualizável no Garage61" : "Conteúdo não liberado pela API"}</strong><span>{selected?.garage61.blockedCommercialDetected ? "Há setup comercial protegido associado às voltas." : "Aguardando setup acessível ou upload."}</span></div></div></article>
          <article className="panel setup-card"><span className="step-number">02 • COMERCIAL</span><h3>Upload privado</h3><p>Use para TS e outros fornecedores quando o Garage61 bloquear o conteúdo. O arquivo fica privado e associado somente a este carro+pista.</p><label className={`setup-drop ${uploading ? "disabled" : ""}`}><FileUp size={22} /><strong>{uploading ? "Enviando..." : "Enviar setup comercial .sto"}</strong><input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCommercial(file); event.target.value = ""; }} /></label></article>
          <article className="panel setup-card setup-output"><span className="step-number">03 • COFRE</span><h3>Setups disponíveis</h3>{selected?.uploads.length ? <><strong>{selected.uploads.length} arquivo(s) privado(s)</strong><ul>{selected.uploads.map((file) => <li key={file.id}>{file.filename} <span>{Math.ceil(file.file_size / 1024)} KB</span></li>)}</ul></> : <p>Nenhum arquivo comercial enviado para este contexto.</p>}<p className="setup-guardrail">Acesso exclusivo server-side. O arquivo não é publicado nem compartilhado com outros usuários.</p></article>
        </div>
      ) : (
        <div className="engineer-layout">
          <article className="panel engineer-chat"><div className="engineer-message"><Bot size={18} /><div><strong>Engenheiro</strong><p>Conte o que o carro faz na entrada, meio e saída da curva. Se não houver feedback, a análise usará sua volta e a referência ativa da telemetria.</p></div></div><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Ex.: traseira escapa ao soltar o freio na entrada; quero mais confiança sem perder rotação no miolo..." /><div className="engineer-actions"><label className="secondary-button">Anexar setup<input type="file" accept=".sto" /></label><button className="primary-button" disabled>Gerar recomendação</button></div><p className="setup-guardrail">O envio ao engenheiro será ativado após a validação do formato `.sto` e a configuração de um provedor de IA server-side. O botão permanece bloqueado para não inventar ajustes.</p></article>
          <aside className="panel engineer-context"><span className="section-kicker">CONTEXTO AUTOMÁTICO</span><h3>O que entra na análise</h3><ul><li>carro e pista da semana;</li><li>setup atual e padrão;</li><li>telemetria própria e referência ativa;</li><li>feedback de entrada, meio e saída;</li><li>efeito e risco de cada alteração.</li></ul></aside>
        </div>
      )}
    </section>
  );
}
