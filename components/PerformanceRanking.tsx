import { CarFront, MapPin } from "lucide-react";

type RankingItem = { label: string; delta: number; races: number; group?: string | null };
type Props = { items: RankingItem[]; emptyText?: string; kind?: "car" | "track" };

function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`; }

function countryCode(label: string) {
  const value = label.toLowerCase();
  const countries: [string[], string][] = [
    [["monza", "imola", "mugello"], "it"], [["spa", "zolder"], "be"], [["silverstone", "brands hatch", "donington", "oulton", "snetterton"], "gb"],
    [["nürburgring", "nurburgring", "hockenheim", "sachsenring"], "de"], [["interlagos", "josé carlos pace"], "br"], [["suzuka", "fuji", "motegi", "okayama"], "jp"],
    [["le mans", "magny", "paul ricard"], "fr"], [["barcelona", "jerez", "aragon"], "es"], [["mount panorama", "phillip island", "sandown", "oran park"], "au"],
    [["canadian tire", "mosport", "montreal", "gilles villeneuve"], "ca"], [["red bull ring"], "at"], [["zandvoort"], "nl"], [["portimão", "estoril"], "pt"],
    [["miami", "daytona", "sebring", "watkins glen", "road america", "road atlanta", "indianapolis", "laguna seca", "virginia international"], "us"],
    [["hermanos rodríguez", "hermanos rodriguez"], "mx"], [["hungaroring"], "hu"], [["motorsport arena oschersleben"], "de"],
  ];
  return countries.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? null;
}

function manufacturerSlug(label: string) {
  const value = label.toLowerCase();
  const brands: [string[], string][] = [
    [["mclaren"], "mclaren"], [["mercedes"], "mercedes"], [["ferrari"], "ferrari"], [["porsche"], "porsche"], [["bmw"], "bmw"],
    [["ford"], "ford"], [["lamborghini"], "lamborghini"], [["aston martin"], "astonmartin"], [["chevrolet", "corvette"], "chevrolet"],
    [["acura"], "acura"], [["cadillac"], "cadillac"], [["toyota"], "toyota"], [["honda"], "honda"], [["audi"], "audi"],
  ];
  return brands.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? null;
}

export default function PerformanceRanking({ items, emptyText, kind = "car" }: Props) {
  if (!items.length) return <div className="ranking-empty">{emptyText ?? "Sem dados"}</div>;
  const gains = items.filter((item) => item.delta > 0).slice(0, 5);
  const drops = [...items].filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  const rows = [...gains, ...drops].sort((a, b) => b.delta - a.delta);
  const maxAbs = Math.max(...rows.map((item) => Math.abs(item.delta)), 1);

  return <div className="diverging-ranking">
    <div className="diverging-axis"><span>PERDAS</span><i /><span>GANHOS</span></div>
    {rows.map((item) => {
      const positive = item.delta > 0;
      const width = Math.max(Math.abs(item.delta) / maxAbs * 48, 2);
      const code = kind === "track" ? countryCode(item.label) : null;
      const brand = kind === "car" ? manufacturerSlug(item.label) : null;
      return <div className="diverging-row" key={`${item.group ?? ""}-${item.label}`}>
        <div className="diverging-label">
          {code ? <img src={`https://flagcdn.com/w20/${code}.png`} alt={`Bandeira ${code.toUpperCase()}`} width="20" height="14" /> : brand ? <img className="brand-icon" src={`https://cdn.simpleicons.org/${brand}/1f2933`} alt={`Marca ${brand}`} width="20" height="20" /> : kind === "track" ? <MapPin size={15} /> : <CarFront size={16} />}
          {item.group && <span className="performance-badge">{item.group}</span>}<strong>{item.label}</strong><small>{item.races} corridas</small>
        </div>
        <div className="diverging-bar"><i className="center-line" /><span className={positive ? "positive" : "negative"} style={positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} /></div>
        <b className={positive ? "positive" : "negative"}>{signed(item.delta)}</b>
      </div>;
    })}
  </div>;
}
