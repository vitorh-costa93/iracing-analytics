type RankingItem = {
  label: string;
  delta: number;
  races: number;
  group?: string | null;
};

type Props = {
  items: RankingItem[];
  emptyText?: string;
  kind?: "car" | "track";
};

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`;
}

function trackFlag(label: string) {
  const value = label.toLowerCase();
  const countries: [string[], string][] = [
    [["monza", "imola", "mugello"], "🇮🇹"], [["spa", "zolder"], "🇧🇪"],
    [["silverstone", "brands hatch", "donington", "oulton", "snetterton"], "🇬🇧"],
    [["nürburgring", "nurburgring", "hockenheim", "sachsenring"], "🇩🇪"],
    [["interlagos"], "🇧🇷"], [["suzuka", "fuji", "motegi", "okayama"], "🇯🇵"],
    [["le mans", "magny", "paul ricard"], "🇫🇷"], [["barcelona", "jerez", "aragon"], "🇪🇸"],
    [["mount panorama", "phillip island", "sandown", "oran park"], "🇦🇺"],
    [["canadian tire", "mosport", "montreal"], "🇨🇦"],
  ];
  return countries.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? "🏁";
}

function RankingList({ items, tone, kind }: { items: RankingItem[]; tone: "positive" | "negative"; kind: "car" | "track" }) {
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.delta)), 1);
  return <div className="performance-ranking">{items.map((item) => {
    const width = Math.max((Math.abs(item.delta) / maxAbs) * 100, 3);
    return <div className="performance-row" key={`${tone}-${item.group ?? ""}-${item.label}`}>
      <div className="performance-row-top"><div className="performance-label-wrap">
        <span className="context-icon" aria-hidden>{kind === "track" ? trackFlag(item.label) : "◇"}</span>
        {item.group && <span className="performance-badge">{item.group}</span>}<span className="performance-label">{item.label}</span>
      </div><strong className={tone}>{signed(item.delta)}</strong></div>
      <div className="performance-track"><div className={`performance-fill ${tone}`} style={{ width: `${width}%` }} /></div>
      <div className="performance-meta">{item.races.toLocaleString("pt-BR")} corridas</div>
    </div>;
  })}</div>;
}

export default function PerformanceRanking({ items, emptyText, kind = "car" }: Props) {
  if (!items.length) {
    return <div className="ranking-empty">{emptyText ?? "Sem dados"}</div>;
  }

  return (
    <div className="ranking-split">
      <div><h4>TOP 5 GAINS</h4><RankingList items={items.filter((item) => item.delta > 0).slice(0, 5)} tone="positive" kind={kind} /></div>
      <div><h4>TOP 5 DROPS</h4><RankingList items={[...items].filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5)} tone="negative" kind={kind} /></div>
    </div>
  );
}
