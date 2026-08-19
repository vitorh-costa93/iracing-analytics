"use client";

import { useEffect, useState } from "react";
import { Bot, FileUp, SlidersHorizontal } from "lucide-react";

type Combination = { key: string; label: string };

export default function SetupLab() {
  const [mode, setMode] = useState<"generator" | "engineer">("generator");
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [context, setContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    fetch("/api/telemetry/active-week", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const next = (data.combinations ?? []) as Combination[];
        setCombinations(next);
        setContext(next[0]?.key ?? "");
      })
      .catch(() => setCombinations([]));
  }, []);

  return (
    <section className="setup-lab">
      <div className="setup-intro">
        <div><span className="section-kicker">SETUP LAB</span><h2>Seu engenheiro de pista</h2><p>Compare famílias de setup e transforme sensação e telemetria em mudanças explicadas.</p></div>
        <label className="setup-context"><span>CARRO + PISTA DA SEMANA</span><select value={context} onChange={(event) => setContext(event.target.value)}>{combinations.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>

      <div className="setup-subtabs">
        <button className={mode === "generator" ? "active" : ""} onClick={() => setMode("generator")}><SlidersHorizontal size={16} />Gerador de setup</button>
        <button className={mode === "engineer" ? "active" : ""} onClick={() => setMode("engineer")}><Bot size={16} />Engenheiro</button>
      </div>

      {mode === "generator" ? (
        <div className="setup-grid">
          <article className="panel setup-card"><span className="step-number">01</span><h3>Setup padrão do iRacing</h3><p>Base de comparação da pista e do carro selecionados.</p><label className="setup-drop"><FileUp size={22} /><strong>Selecionar .sto padrão</strong><input type="file" accept=".sto" onChange={(event) => setFiles(event.target.files ? [...files, ...Array.from(event.target.files)] : files)} /></label></article>
          <article className="panel setup-card"><span className="step-number">02</span><h3>Setups de referência</h3><p>Envie os setups usados na temporada; pista e versão ficam associados pelo nome do arquivo.</p><label className="setup-drop"><FileUp size={22} /><strong>Selecionar vários .sto</strong><input multiple type="file" accept=".sto" onChange={(event) => setFiles(event.target.files ? [...files, ...Array.from(event.target.files)] : files)} /></label></article>
          <article className="panel setup-card setup-output"><span className="step-number">03</span><h3>Padrões e efeito esperado</h3>{files.length ? <><strong>{files.length} arquivo(s) preparado(s)</strong><ul>{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name} <span>{Math.ceil(file.size / 1024)} KB</span></li>)}</ul><p className="setup-guardrail">A comparação de parâmetros será habilitada depois de validar a estrutura real desses arquivos. Nenhum `.sto` será regravado às cegas.</p></> : <p>Envie pelo menos um padrão e um comprado para iniciar a comparação.</p>}</article>
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
