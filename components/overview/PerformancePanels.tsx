import { MapPin } from "lucide-react";
import { CarBrandIcon, hideBrokenImage } from "@/lib/car-brand";
import { countryCode } from "@/components/PerformanceRanking";
import { formatSignedSeconds } from "@/lib/engineer-talk";
import { Chip } from "@/components/ui";
import { signedNumber } from "./format";

export type WinnerGapItem = { track: string; races: number; avgGapSeconds: number; avgGapPct: number; bestGapSeconds: number; worstGapSeconds: number };
export type RankingItem = { label: string; delta: number; races: number; group?: string | null; avgDelta: number };

function evidence(races: number) {
  if (races >= 8) return "evidência consistente";
  if (races >= 4) return "evidência moderada";
  return "sinal inicial";
}

function Lead({ kind, label }: { kind: "track" | "car"; label: string }) {
  const code = kind === "track" ? countryCode(label) : null;
  if (code) return <img className="ngo-flag" src={`https://flagcdn.com/w20/${code}.png`} alt={`Bandeira ${code.toUpperCase()}`} width={20} height={14} onError={hideBrokenImage} />;
  return <span className="ngo-lead-icon">{kind === "track" ? <MapPin size={15} /> : <CarBrandIcon name={label} />}</span>;
}

/** Medida 1: média de Δ iRating por pista/carro, barras divergentes (até 5 maiores ganhos e 5 maiores
 * perdas, mesma seleção de antes). */
export function DeltaByContext({ items, kind, emptyText }: { items: RankingItem[]; kind: "track" | "car"; emptyText?: string }) {
  if (!items.length) return <div className="ngo-empty">{emptyText ?? "Sem dados"}</div>;
  const gains = items.filter((i) => i.avgDelta > 0).sort((a, b) => b.avgDelta - a.avgDelta).slice(0, 5);
  const drops = items.filter((i) => i.avgDelta < 0).sort((a, b) => a.avgDelta - b.avgDelta).slice(0, 5);
  const rows = [...gains, ...drops].sort((a, b) => b.avgDelta - a.avgDelta);
  const maxAbs = Math.max(...rows.map((i) => Math.abs(i.avgDelta)), 1);
  return (
    <div className="ngo-rank">
      <div className="ngo-rank-axis"><span /><span><span>PERDAS</span><span>GANHOS</span></span><span /></div>
      {rows.map((item) => {
        const positive = item.avgDelta > 0;
        const w = Math.max((Math.abs(item.avgDelta) / maxAbs) * 48, 2);
        const tone = positive ? "var(--ng-gain)" : "var(--ng-loss)";
        return (
          <div className="ngo-rank-row" key={`${item.group ?? ""}-${item.label}`}>
            <div className="ngo-rank-label">
              <Lead kind={kind} label={item.label} />
              {item.group && <Chip variant="code">{item.group}</Chip>}
              <div className="ngo-rank-text">
                <div className="ngo-rank-name">{item.label}</div>
                <div className="ngo-rank-sub">{item.races} corridas · saldo total {signedNumber(item.delta, 0)} · {evidence(item.races)}</div>
              </div>
            </div>
            <div className="ngo-rank-bar">
              <i className="ngo-rank-center" />
              <span style={{ background: tone, left: positive ? "50%" : `${50 - w}%`, width: `${w}%` }} />
            </div>
            <div className="ngo-rank-value" style={{ color: tone }}>{signedNumber(item.avgDelta, 1)}<span>/corrida</span></div>
          </div>
        );
      })}
    </div>
  );
}


function seconds(v: number) { return formatSignedSeconds(v); }
function percent(v: number) { return `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; }

export function gapOverall(items: WinnerGapItem[]) {
  const races = items.reduce((s, i) => s + i.races, 0);
  return races ? items.reduce((s, i) => s + i.avgGapPct * i.races, 0) / races : 0;
}

/** Medida 2: gap percentual para a melhor volta do vencedor, por pista (menor para maior). */
export function GapToWinner({ items }: { items: WinnerGapItem[] }) {
  if (!items.length) return <div className="ngo-empty">Ainda sem corridas com a volta do vencedor. Ela passa a ser capturada nas próximas importações do iRStats.</div>;
  const maxPct = Math.max(...items.map((i) => Math.abs(i.avgGapPct)), 0.01);
  const overall = gapOverall(items);
  return (
    <div className="ngo-rank">
      <div className="ngo-rank-axis"><span /><span><span>MAIS PERTO</span><span>MAIS LONGE</span></span><span /></div>
      {items.map((item) => {
        const tone = item.avgGapPct <= overall ? "var(--ng-gain)" : "var(--ng-loss)";
        const w = Math.max((Math.abs(item.avgGapPct) / maxPct) * 100, 2);
        return (
          <div className="ngo-rank-row" key={item.track}>
            <div className="ngo-rank-label">
              <Lead kind="track" label={item.track} />
              <div className="ngo-rank-text">
                <div className="ngo-rank-name">{item.track}</div>
                <div className="ngo-rank-sub">{item.races} corr. · melhor {seconds(item.bestGapSeconds)} · pior {seconds(item.worstGapSeconds)}</div>
              </div>
            </div>
            <div className="ngo-rank-bar"><span style={{ background: tone, left: 0, width: `${w}%` }} /></div>
            <div className="ngo-rank-value ngo-rank-value-2" style={{ color: tone }}>{percent(item.avgGapPct)}<span>média {seconds(item.avgGapSeconds)}</span></div>
          </div>
        );
      })}
    </div>
  );
}
