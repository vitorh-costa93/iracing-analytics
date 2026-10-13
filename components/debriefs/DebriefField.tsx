import type { DebriefField } from "@/lib/debrief-types";
import { CAUSE_ORDER, CASCADE_ORDER, type CascadeKey, type CarRow, type ExitCause, type FieldSide, type ScatterPoint } from "@/lib/debrief-field";
import { dec, signedDec, signedInt } from "@/lib/debrief-narrative";

/** Painéis do campo completo da corrida (13/10/2026): ritmo no grid × resultado, cascata, causas da saída e
 * quadro por carro. Sempre "agora" contra a referência (mesmo ponto da season anterior / mesma semana). */

const X0 = 46, X1 = 544, Y0 = 14, Y1 = 224, YMID = (Y0 + Y1) / 2;
const tone = (value: number) => (value > 0 ? "gain" : value < 0 ? "loss" : "neutral");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const pct = (value: number | null) => (value === null ? "—" : value + "%");
const top = (value: number | null) => (value === null ? "—" : "top " + value + "%");

export function GridScatter({ now, before, label }: { now: ScatterPoint[]; before: ScatterPoint[]; label: string }) {
  const maxAbs = Math.max(60, ...now.map((point) => Math.abs(point.delta)), ...before.map((point) => Math.abs(point.delta))) * 1.1;
  const x = (pace: number) => X0 + (pace / 100) * (X1 - X0);
  const y = (value: number) => YMID - (Math.max(-maxAbs, Math.min(maxAbs, value)) / maxAbs) * (YMID - Y0 - 6);
  return (
    <svg className="ngd-scatter" viewBox="0 0 560 250" role="img" aria-label="Ritmo no grid contra resultado">
      <line x1={295} x2={295} y1={Y0} y2={Y1} stroke="var(--ng-tooltip-border)" strokeDasharray="4 4" />
      <line x1={X0} x2={X1} y1={YMID} y2={YMID} stroke="#5C6A9E" />
      <text x={54} y={28} fontSize={11} fill="var(--ng-gain)" fontWeight={600}>RÁPIDO E GANHANDO</text>
      <text x={540} y={28} fontSize={11} fill="var(--ng-caution)" fontWeight={600} textAnchor="end">DEVAGAR E GANHANDO</text>
      <text x={54} y={218} fontSize={11} fill="var(--ng-loss)" fontWeight={600}>RÁPIDO, MAS PERDENDO</text>
      <text x={540} y={218} fontSize={11} fill="var(--ng-loss)" fontWeight={600} textAnchor="end">DEVAGAR E PERDENDO</text>
      <text x={X0} y={244} fontSize={11} fill="var(--ng-soft)">top 0%</text>
      <text x={295} y={244} fontSize={11} fill="var(--ng-soft)" textAnchor="middle">50%</text>
      <text x={X1} y={244} fontSize={11} fill="var(--ng-soft)" textAnchor="end">100% (mais lento)</text>
      {before.map((point, index) => (
        <circle key={"b" + index} cx={x(point.pacePct).toFixed(1)} cy={y(point.delta).toFixed(1)} r={4} className="o"><title>{label + ": top " + point.pacePct + "% no grid · " + signedInt(point.delta) + " de iRating"}</title></circle>
      ))}
      {now.map((point, index) => (
        <circle key={"n" + index} cx={x(point.pacePct).toFixed(1)} cy={y(point.delta).toFixed(1)} r={5.5} className={point.delta >= 0 ? "g" : "l"}>
          <title>{shortDate(point.date) + " · " + point.car + ": top " + point.pacePct + "% no grid · " + signedInt(point.delta) + " de iRating" + (point.exitLap !== null ? " (saiu na volta " + point.exitLap + " de " + point.classLaps + ")" : "")}</title>
        </circle>
      ))}
    </svg>
  );
}

const CASCADE_LABEL: Record<CascadeKey, string> = { completed: "Concluídas", lapOne: "Até 1 volta", under25: "Antes de 25%", to50: "25–50%", to75: "50–75%", to90: "75–90%" };

export function Cascade({ now, before, referenceName }: { now: FieldSide; before: FieldSide; referenceName: string }) {
  const rows = CASCADE_ORDER.filter((key) => now.cascade[key].count || before.cascade[key].count);
  const max = Math.max(1, ...CASCADE_ORDER.flatMap((key) => [Math.abs(now.cascade[key].delta), Math.abs(before.cascade[key].delta)]), Math.abs(now.net), Math.abs(before.net)) * 1.08;
  const width = (value: number) => ((Math.abs(value) / max) * 100).toFixed(1) + "%";
  const pair = (value: number, kind: "now" | "ref" | "net") => (
    <div className="ngd-cr-pair">
      <div className="ngd-cr-track">{value !== 0 && <div className="ngd-cr-fill" data-kind={kind === "ref" ? "ref" : value > 0 ? "gain" : "loss"} style={{ width: width(value) }} />}</div>
      <span className="ngd-cr-value" data-tone={kind === "ref" ? "muted" : tone(value)}>{signedInt(value)}</span>
    </div>
  );
  return (
    <div role="img" aria-label={"Cascata: " + rows.map((key) => CASCADE_LABEL[key] + " " + signedInt(now.cascade[key].delta) + " contra " + signedInt(before.cascade[key].delta)).join("; ") + "; líquido " + signedInt(now.net) + " contra " + signedInt(before.net)}>
      <div className="ngd-legend ngd-cr-legend"><span data-kind="gain">■ agora, ganho</span><span data-kind="loss">■ agora, perda</span><span data-kind="ref">■ {referenceName}</span></div>
      {rows.map((key) => (
        <div className="ngd-cr" key={key}>
          <span className="ngd-cr-label">{CASCADE_LABEL[key]} ({now.cascade[key].count} · {before.cascade[key].count})</span>
          <div className="ngd-cr-bars">{pair(now.cascade[key].delta, "now")}{pair(before.cascade[key].delta, "ref")}</div>
        </div>
      ))}
      <div className="ngd-cr ngd-cr-total">
        <span className="ngd-cr-label">Líquido ({now.races} · {before.races})</span>
        <div className="ngd-cr-bars">{pair(now.net, "net")}{pair(before.net, "ref")}</div>
      </div>
    </div>
  );
}

const CAUSE_TEXT: Record<ExitCause, { title: string; sub: string }> = {
  abrupt: { title: "Parada brusca com ritmo normal", sub: "ritmo ~100% da mediana até a volta anterior" },
  lapOne: { title: "Volta 1: toque ou reset", sub: "saída em até 1 volta, com salto de posição" },
  damage: { title: "Ritmo cai antes de sair", sub: "voltas mais de 15% mais lentas: provável dano" },
  offTrack: { title: "Fora da pista na última volta", sub: "última volta marcada como fora da pista" },
};
const tally = (value: { count: number; delta: number }) => (value.count ? value.count + " · " + signedInt(value.delta) : "0");

export function CausesTable({ field, referenceName }: { field: DebriefField; referenceName: string }) {
  const { now, before } = field.causes;
  const total = (side: typeof now) => { const all = Object.values(side); return { count: all.reduce((a, b) => a + b.count, 0), delta: all.reduce((a, b) => a + b.delta, 0) }; };
  const hasReference = field.before.races > 0;
  return (
    <div className="ngd-scroll-x">
      <table className="ngd-table">
        <thead><tr><th>Causa provável</th><th className="r">Agora</th><th className="r sep">{referenceName}</th></tr></thead>
        <tbody>
          {CAUSE_ORDER.map((key) => (
            <tr key={key}>
              <td><strong>{CAUSE_TEXT[key].title}</strong><span className="sub">{CAUSE_TEXT[key].sub}</span></td>
              <td className="r" data-tone={now[key].count ? "loss" : "muted"}>{tally(now[key])}</td>
              <td className="r sep" data-tone={before[key].count ? "loss" : "muted"}>{hasReference ? tally(before[key]) : "—"}</td>
            </tr>
          ))}
          {(now.unknown.count > 0 || before.unknown.count > 0) && (
            <tr><td><strong>Sem voltas para classificar</strong><span className="sub">a sessão não está no Garage61 nem no agente</span></td><td className="r" data-tone="muted">{tally(now.unknown)}</td><td className="r sep" data-tone="muted">{tally(before.unknown)}</td></tr>
          )}
          <tr className="ngd-table-total"><td><strong>Total</strong></td><td className="r" data-tone={total(now).count ? "loss" : "muted"}><strong>{tally(total(now))}</strong></td><td className="r sep" data-tone={total(before).count ? "loss" : "muted"}><strong>{hasReference ? tally(total(before)) : "—"}</strong></td></tr>
        </tbody>
      </table>
    </div>
  );
}

const MIN_CAR_RACES = 5;
export function CarsTable({ field, referenceName, segmentLabel }: { field: DebriefField; referenceName: string; segmentLabel: string }) {
  const names = [...new Set([...field.cars.now.map((row) => row.car), ...field.cars.before.map((row) => row.car)])];
  const find = (rows: CarRow[], name: string) => rows.find((row) => row.car === name);
  const order = (name: string) => (find(field.cars.now, name)?.races ?? 0) * 100 + (find(field.cars.before, name)?.races ?? 0);
  names.sort((a, b) => order(b) - order(a) || a.localeCompare(b));
  const cells = (row: CarRow | FieldSide | undefined, separated: boolean) => {
    const cls = separated ? "r sep" : "r";
    if (!row || !row.races) return [<td key="n" className={cls + " muted"}>—</td>, <td key="d" className="r muted">—</td>, <td key="e" className="r muted">—</td>, <td key="p" className="r muted">—</td>, <td key="v" className="r muted">—</td>];
    const dim = row.races < MIN_CAR_RACES;
    const exitRate = row.permanencePct === null ? null : 100 - row.permanencePct;
    return [
      <td key="n" className={cls + (dim ? " muted" : "")}>{row.races}</td>,
      <td key="d" className="r" data-tone={dim ? "muted" : tone(row.net)}>{signedInt(row.net)}</td>,
      <td key="e" className="r" data-tone={dim ? "muted" : exitRate ? "loss" : undefined}>{pct(exitRate)}</td>,
      <td key="p" className={"r" + (dim ? " muted" : "")}>{top(row.paceTopPct)}</td>,
      <td key="v" className="r" data-tone={dim || row.residualAvg === null ? "muted" : tone(row.residualAvg)}>{row.residualAvg === null ? "—" : signedDec(row.residualAvg, 1)}</td>,
    ];
  };
  return (
    <div className="ngd-scroll-x">
      <table className="ngd-table">
        <thead>
          <tr><th rowSpan={2}>Carro</th><th className="grp" colSpan={5}>Agora</th><th className="grp sep" colSpan={5}>{referenceName}</th></tr>
          <tr><th className="r">Corr.</th><th className="r">Δ iR</th><th className="r">Saída</th><th className="r">Ritmo</th><th className="r">vs esp.</th><th className="r sep">Corr.</th><th className="r">Δ iR</th><th className="r">Saída</th><th className="r">Ritmo</th><th className="r">vs esp.</th></tr>
        </thead>
        <tbody>
          {names.map((name) => <tr key={name}><td>{name.replace(" GT3 EVO", "").replace(" (992)", "")}</td>{cells(find(field.cars.now, name), false)}{cells(find(field.cars.before, name), true)}</tr>)}
          <tr className="ngd-table-total"><td><strong>Total {segmentLabel}</strong></td>{cells(field.now, false)}{cells(field.before, true)}</tr>
        </tbody>
      </table>
    </div>
  );
}

export const fieldTone = tone;
export { dec };
