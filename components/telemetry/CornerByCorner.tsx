"use client";

import { Panel, SegmentedControl } from "@/components/ui";
import { describeSection, formatSeconds, formatSignedSeconds } from "@/lib/engineer-talk";
import { wrapDistance } from "@/lib/corner-sequences";
import { SECTION_LOSS_THRESHOLD, sectionTotals, type LapComparison, type SectionResult } from "@/lib/lap-analysis";

export type CornerFilter = "all" | "loss" | "gain";

const FILTERS = [
  { value: "all" as const, label: "Todos" },
  { value: "loss" as const, label: "Onde eu perco" },
  { value: "gain" as const, label: "Meus pontos fortes" },
];

export function isLossSection(section: SectionResult) {
  return section.lostSeconds > SECTION_LOSS_THRESHOLD;
}

export function filterSections(sections: SectionResult[], filter: CornerFilter) {
  return sections.filter((section) => filter === "all" || (filter === "loss") === isLossSection(section));
}

/**
 * Resumo do curva a curva: perdido, ganho, retas e transições e o saldo da volta. O resíduo das retas
 * (`straightsLostSeconds`) é o que faltava para a soma fechar na tela (auditoria B, 26/09/2026):
 * perdido - ganho + retas = saldo. Usado na semana ativa e na Comparação de carros.
 */
export function SectionTotalsSummary({ comparison, against }: { comparison: LapComparison; against: string }) {
  const totals = sectionTotals(comparison);
  const straightsTone = totals.straightsLost > SECTION_LOSS_THRESHOLD ? "loss" : totals.straightsLost < -SECTION_LOSS_THRESHOLD ? "gain" : undefined;
  return (
    <div className="ngt-summary">
      <div><strong data-tone="loss">{formatSeconds(totals.lost)}</strong><span>perdidos em {totals.lossCount} {totals.lossCount === 1 ? "trecho" : "trechos"}</span></div>
      <div><strong data-tone="gain">{formatSeconds(Math.max(0, totals.gained))}</strong><span>ganhos em {totals.gainCount} {totals.gainCount === 1 ? "trecho" : "trechos"}</span></div>
      <div><strong data-tone={straightsTone}>{formatSignedSeconds(-totals.straightsLost)}</strong><span>nas retas e transições</span></div>
      <div><strong>{formatSignedSeconds(-totals.gap)}</strong><span>saldo da volta contra {against}</span></div>
    </div>
  );
}

/** Seção "Curva a curva" (Telemetry.dc.html): todos os trechos com tempo ganho/perdido, barra
 * divergente, frase curta e etiqueta; curvas coladas aparecem como uma sequência só. */
export default function CornerByCorner({ comparison, filter, onFilter, biggestLossId, onOpen, micro }: {
  comparison: LapComparison;
  filter: CornerFilter;
  onFilter: (filter: CornerFilter) => void;
  biggestLossId: string | null;
  onOpen: (id: string) => void;
  /** resumo das microcorreções da volta contra a referência (lib/microcorrection-talk.ts) */
  micro?: { text: string; tone: "gain" | "loss" | "neutral" } | null;
}) {
  const sections = comparison.sections;
  const maxAbs = Math.max(0.01, ...sections.map((section) => Math.abs(section.lostSeconds)));
  const visible = filterSections(sections, filter);

  return (
    <Panel kicker="Curva a curva" title="Onde você perde e onde você é forte"
      subtitle="Curvas coladas viram uma sequência só: uma não vale sozinha, porque você pode sacrificar a entrada de uma para sair melhor da outra. Clique para ver o detalhe."
      actions={<SegmentedControl options={FILTERS} value={filter} onChange={onFilter} ariaLabel="Filtrar trechos" />}>
      <SectionTotalsSummary comparison={comparison} against="a referência" />
      {micro && <p className="ngt-micro-note" data-tone={micro.tone === "neutral" ? undefined : micro.tone}>{micro.text}</p>}
      <div className="ngt-rows-head" aria-hidden><span>Trecho</span><span><span>Perde</span><span>Ganha</span></span><span>Tempo</span><span>Em uma frase</span><span /></div>
      {visible.length === 0 && <div className="ngt-empty-list">{filter === "loss" ? "Nenhum trecho com perda contra a referência." : filter === "gain" ? "Nenhum trecho em que você ganha da referência." : "Nenhuma curva detectada nesta volta."}</div>}
      {visible.map((section) => {
        const talk = describeSection(section, { isBiggestLoss: section.id === biggestLossId });
        const loss = talk.tag === "Onde perde";
        const w = Math.max((Math.abs(section.lostSeconds) / maxAbs) * 48, 2);
        return (
          <button key={section.id} type="button" className="ngt-row" data-tone={loss ? "loss" : "gain"} onClick={() => onOpen(section.id)}
            aria-label={`${section.label}: ${formatSignedSeconds(-section.lostSeconds)}. ${talk.note} Abrir detalhe.`}>
            <div>
              <div className="ngt-row-name">{section.label}{section.isSequence ? " · sequência" : ""}</div>
              <div className="ngt-row-range">{Math.round(wrapDistance(section.start))}%–{Math.round(wrapDistance(section.end))}% da volta</div>
            </div>
            <div className="ngt-bar" aria-hidden><div className="ngt-bar-axis" /><div className="ngt-bar-fill" style={{ left: loss ? `${50 - w}%` : "50%", width: `${w}%` }} /></div>
            <div className="ngt-row-dt">{formatSignedSeconds(-section.lostSeconds)}</div>
            <div className="ngt-row-note">{talk.note}</div>
            <div className="ngt-row-tag"><span className="ngt-tag" data-tone={loss ? "loss" : "gain"}>{talk.tag}</span></div>
          </button>
        );
      })}
    </Panel>
  );
}
