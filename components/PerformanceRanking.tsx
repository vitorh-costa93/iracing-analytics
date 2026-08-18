type RankingItem = {
  label: string;
  delta: number;
  races: number;
  group?: string | null;
};

type Props = {
  items: RankingItem[];
  emptyText?: string;
};

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`;
}

export default function PerformanceRanking({ items, emptyText }: Props) {
  if (!items.length) {
    return <div className="ranking-empty">{emptyText ?? "Sem dados"}</div>;
  }

  const maxAbs = Math.max(...items.map((item) => Math.abs(item.delta)), 1);

  return (
    <div className="performance-ranking">
      {items.slice(0, 10).map((item) => {
        const width = Math.max((Math.abs(item.delta) / maxAbs) * 100, 3);
        const tone = item.delta > 0 ? "positive" : item.delta < 0 ? "negative" : "neutral";

        return (
          <div className="performance-row" key={`${item.group ?? ""}-${item.label}`}>
            <div className="performance-row-top">
              <div className="performance-label-wrap">
                {item.group && <span className="performance-badge">{item.group}</span>}
                <span className="performance-label">{item.label}</span>
              </div>
              <strong className={tone}>{signed(item.delta)}</strong>
            </div>
            <div className="performance-track">
              <div className={`performance-fill ${tone}`} style={{ width: `${width}%` }} />
            </div>
            <div className="performance-meta">{item.races.toLocaleString("pt-BR")} corridas</div>
          </div>
        );
      })}
    </div>
  );
}
