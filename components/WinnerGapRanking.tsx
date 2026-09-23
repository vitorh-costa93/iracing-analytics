import { MapPin } from "lucide-react";
import { hideBrokenImage } from "@/lib/car-brand";
import { countryCode } from "@/components/PerformanceRanking";

export type WinnerGapItem = { track: string; races: number; avgGapSeconds: number; avgGapPct: number; bestGapSeconds: number; worstGapSeconds: number };

function seconds(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}s`;
}

function percent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export default function WinnerGapRanking({ items }: { items: WinnerGapItem[] }) {
  if (!items.length) {
    return <div className="ranking-empty">Ainda sem corridas com a volta do vencedor. Ela passa a ser capturada nas próximas importações do iRStats.</div>;
  }
  const maxPct = Math.max(...items.map((item) => Math.abs(item.avgGapPct)), 0.01);
  const overallPct = items.reduce((sum, item) => sum + item.avgGapPct * item.races, 0) / items.reduce((sum, item) => sum + item.races, 0);

  return <div className="diverging-ranking">
    <div className="diverging-axis"><span>MAIS PERTO DO VENCEDOR</span><i /><span>MAIS LONGE</span></div>
    {items.map((item) => {
      const code = countryCode(item.track);
      const tone = item.avgGapPct <= overallPct ? "positive" : "negative";
      const width = Math.max(Math.abs(item.avgGapPct) / maxPct * 100, 2);
      return <div className="diverging-row" key={item.track}>
        <div className="diverging-label">
          {code ? <img src={`https://flagcdn.com/w20/${code}.png`} alt={`Bandeira ${code.toUpperCase()}`} width="20" height="14" onError={hideBrokenImage} /> : <MapPin size={15} />}
          <strong>{item.track}</strong>
          <small>{item.races} {item.races === 1 ? "corrida" : "corridas"} • média {seconds(item.avgGapSeconds)} • melhor {seconds(item.bestGapSeconds)} • pior {seconds(item.worstGapSeconds)}</small>
        </div>
        <div className="diverging-bar gap-bar"><span className={tone} style={{ left: 0, width: `${width}%` }} /></div>
        <b className={tone}>{percent(item.avgGapPct)}</b>
      </div>;
    })}
  </div>;
}
