import { Panel } from "@/components/ui";
import type { ResolvedProposal } from "@/lib/engineer-proposal";

/** Painel "O que mudou" (Setup.dc.html, coluna da direita): setup ativo (A) → proposta do engenheiro (B),
 * em linguagem simples e com a tabela por categoria. B nunca é um arquivo: é o que o piloto aplica à mão. */
export function ProposalPanel({ proposal, activeName, activeSetupId }: { proposal: ResolvedProposal | null; activeName: string | null; activeSetupId: string }) {
  const baseName = proposal?.baseName ?? activeName;
  const otherBase = proposal && activeSetupId && proposal.baseSetupId !== activeSetupId;
  const expectations = proposal ? [proposal.better, proposal.worse, proposal.test].filter(Boolean) : [];
  return (
    <Panel
      as="aside"
      className="ngs-ab"
      kicker="O QUE MUDOU"
      title={`Setup A${baseName ? ` (${baseName})` : ""} → Setup B (proposta)`}
      subtitle={otherBase ? `Proposta feita sobre o ${proposal!.baseName}; escolha esse setup no topo para continuar a partir dela` : "Montado a partir do seu feedback na conversa ao lado"}
    >
      {!proposal ? (
        <div className="ngs-ab-empty">
          <p><strong>Sem proposta ainda.</strong> Conte ao engenheiro o que o carro está fazendo. Quando ele sugerir uma mudança, o Setup B aparece aqui com o que mudou, por que e o que esperar.</p>
          <p>O arquivo .sto original nunca é reescrito: você aplica a mudança à mão, no menu do carro dentro do iRacing.</p>
        </div>
      ) : (
        <div className="ngs-ab-body">
          <div className="ngs-ab-cards">
            <div className="ngs-ab-card">
              <div className="ngs-ab-kicker" data-tone="gain">O QUE MUDOU</div>
              <div className="ngs-ab-text">{proposal.what || proposal.changes.map((change) => `${change.name}: ${change.a} → ${change.b}`).join("; ") || "O Setup B voltou a ficar igual ao A."}</div>
            </div>
            {proposal.why && (
              <div className="ngs-ab-card">
                <div className="ngs-ab-kicker" data-tone="formula">POR QUE</div>
                <div className="ngs-ab-text">{proposal.why}</div>
              </div>
            )}
            {expectations.length > 0 && (
              <div className="ngs-ab-card">
                <div className="ngs-ab-kicker" data-tone="reference">O QUE ESPERAR</div>
                {expectations.map((item) => <div key={item} className="ngs-ab-bullet"><span aria-hidden />{item}</div>)}
              </div>
            )}
          </div>
          {proposal.table.length > 0 && (
            <div className="ngs-ab-table">
              <div className="ngs-param-row ngs-param-head"><span>Parâmetro</span><span>A</span><span>B</span></div>
              {proposal.table.map((group) => (
                <div key={group.group}>
                  <div className="ngs-param-group">{group.group.toUpperCase()}</div>
                  {group.rows.map((row) => (
                    <div key={row.name} className="ngs-param-row">
                      <span>{row.name}</span>
                      <span className="ngs-param-a">{row.a}</span>
                      <span className="ngs-param-b" data-changed={row.changed ? "" : undefined}>{row.b}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
