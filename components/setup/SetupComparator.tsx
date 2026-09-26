"use client";

import { Panel, SelectPill } from "@/components/ui";
import { setupDisplayName, setupSourceLabel } from "@/lib/setup-names";
import type { CompareResult, SetupUpload } from "./types";

/** "Comparar dois setups" (Setup.dc.html, faixa de baixo). A análise é determinística
 * (lib/setup-explain.ts via /api/setup/compare): sem custo de IA e sempre o mesmo texto para o mesmo par. */
export function SetupComparator({ setups, baseId, comparisonId, onBase, onComparison, onRun, running, result, error }: {
  setups: SetupUpload[];
  baseId: string;
  comparisonId: string;
  onBase: (id: string) => void;
  onComparison: (id: string) => void;
  onRun: () => void;
  running: boolean;
  result: CompareResult | null;
  error: string | null;
}) {
  const options = [{ value: "", label: setups.length ? "Escolha um setup" : "Nenhum setup deste carro" }, ...setups.map((setup) => ({ value: setup.id, label: `${setupDisplayName(setup.filename)} · ${setupSourceLabel(setup.source)}` }))];
  const canRun = Boolean(baseId && comparisonId && baseId !== comparisonId) && !running;
  const groups = result ? [...new Set(result.changes.map((change) => change.group))] : [];
  const settable = result ? result.changes.filter((change) => change.settable).length : 0;
  return (
    <Panel as="section" className="ngs-compare" kicker="COMPARAR DOIS SETUPS" title="Escolha dois e eu explico a diferença" subtitle="Sem jargão: o que cada setup faz no carro e quando usar cada um">
      <div className="ngs-compare-controls">
        <span className="ng-field-label">Setup A</span>
        <SelectPill ariaLabel="Setup A" options={options} value={baseId} onChange={onBase} className="ngs-compare-select" />
        <span className="ng-field-label">Setup B</span>
        <SelectPill ariaLabel="Setup B" options={options} value={comparisonId} onChange={onComparison} className="ngs-compare-select" />
        <button type="button" className="ng-button ngs-run" disabled={!canRun} onClick={onRun}>{running ? "Analisando…" : "Rodar análise completa"}</button>
        <div className="ngs-grow" />
        {result && <span className="ngs-compare-count">{settable} {settable === 1 ? "parâmetro com efeito prático difere" : "parâmetros com efeito prático diferem"}</span>}
      </div>
      {error && <div className="ngs-note" data-tone="loss">{error}</div>}
      {!result && !error && (
        <div className="ngs-note">{setups.length < 2 ? "Este carro e pista ainda têm menos de dois setups lidos pelo Garage61." : "Escolha dois setups diferentes e rode a análise."}</div>
      )}
      {result && (
        <>
          <div className="ngs-compare-cards">
            <div className="ngs-ab-card">
              <div className="ngs-ab-kicker" data-tone="gain">A DIFERENÇA EM UMA FRASE</div>
              <div className="ngs-ab-text">{result.explanation.oneLiner}</div>
            </div>
            <div className="ngs-ab-card">
              <div className="ngs-ab-kicker" data-tone="formula">COMO VOCÊ VAI SENTIR</div>
              <div className="ngs-ab-text">Entrada: {result.explanation.feel.entry} Meio: {result.explanation.feel.mid} Saída: {result.explanation.feel.exit}</div>
            </div>
            <div className="ngs-ab-card">
              <div className="ngs-ab-kicker" data-tone="reference">QUANDO USAR CADA UM</div>
              <div className="ngs-ab-text">{result.explanation.whenToUse}</div>
            </div>
          </div>
          {result.explanation.glossary.length > 0 && (
            <div className="ngs-glossary">
              <span className="ngs-glossary-label">GLOSSÁRIO:</span>
              {result.explanation.glossary.map((item) => <span key={item.term} className="ngs-glossary-chip">{item.term}: {item.meaning}</span>)}
            </div>
          )}
          {result.changes.length > 0 && (
            <details className="ngs-compare-details">
              <summary>Como testar e as {result.changes.length} diferenças, uma por uma</summary>
              <ol className="ngs-test-steps">{result.explanation.testSteps.map((step) => <li key={step}>{step}</li>)}</ol>
              <p className="ngs-compare-summary">{result.summary}</p>
              <div className="ngs-param-row ngs-param-head ngs-compare-row"><span>Parâmetro</span><span>{result.base.name}</span><span>{result.comparison.name}</span></div>
              {groups.map((group) => (
                <div key={group}>
                  <div className="ngs-param-group">{group.toUpperCase()}</div>
                  {result.changes.filter((change) => change.group === group).map((change) => (
                    <div key={`${change.label}-${change.name}`} className="ngs-compare-item">
                      <div className="ngs-param-row ngs-compare-row">
                        <span>{change.name}{!change.settable && <em className="ngs-readonly"> · resultado da sessão, não é ajuste</em>}</span>
                        <span className="ngs-param-a">{change.before}</span>
                        <span className="ngs-param-b" data-changed="">{change.after}</span>
                      </div>
                      <p>{change.explanation}</p>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
