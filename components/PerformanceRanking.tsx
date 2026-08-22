import { CarFront, MapPin } from "lucide-react";

type RankingItem = { label: string; delta: number; races: number; group?: string | null; avgDelta: number };
type Props = { items: RankingItem[]; emptyText?: string; kind?: "car" | "track" };

function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`; }
function signedAvg(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`; }

function countryCode(label: string) {
  const value = label.toLowerCase();
  const countries: [string[], string][] = [
    [["monza", "imola", "mugello", "vallelunga", "misano"], "it"], [["spa", "zolder"], "be"], [["silverstone", "brands hatch", "donington", "oulton", "snetterton", "knockhill", "thruxton", "cadwell"], "gb"],
    [["nürburgring", "nurburgring", "hockenheim", "sachsenring", "motorsport arena oschersleben"], "de"], [["interlagos", "josé carlos pace"], "br"], [["suzuka", "fuji", "motegi", "okayama", "twin ring"], "jp"],
    [["le mans", "24 heures du mans", "magny", "paul ricard", "dijon"], "fr"], [["barcelona", "jerez", "aragon", "catalunya"], "es"],
    [["mount panorama", "bathurst", "phillip island", "sandown", "oran park", "the bend", "queensland raceway", "winton"], "au"],
    [["canadian tire", "mosport", "montreal", "gilles villeneuve"], "ca"], [["red bull ring"], "at"], [["zandvoort", "assen"], "nl"],
    [["portimão", "portimao", "estoril", "algarve"], "pt"],
    [["miami", "daytona", "sebring", "watkins glen", "road america", "road atlanta", "indianapolis", "laguna seca", "virginia international",
      "sonoma", "lime rock", "long beach", "charlotte", "talladega", "phoenix", "circuit of the americas", "cota", "willow springs",
      "summit point", "detroit", "mid-ohio", "iowa", "gateway", "richmond", "homestead", "kansas", "michigan", "texas motor", "new hampshire"], "us"],
    [["hermanos rodríguez", "hermanos rodriguez"], "mx"], [["hungaroring"], "hu"], [["kyalami"], "za"],
  ];
  return countries.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? null;
}

const BRAND_LOGO_OVERRIDES: Record<string, string> = {
  mercedes: "https://upload.wikimedia.org/wikipedia/commons/b/b8/Mercedes-Benz_Star.svg",
  dallara: "https://upload.wikimedia.org/wikipedia/commons/6/60/Dallara_logo.svg",
};

function manufacturerSlug(label: string) {
  const value = label.toLowerCase();
  const brands: [string[], string][] = [
    [["mclaren"], "mclaren"], [["mercedes"], "mercedes"], [["ferrari"], "ferrari"], [["porsche"], "porsche"], [["bmw"], "bmw"],
    [["ford"], "ford"], [["lamborghini"], "lamborghini"], [["aston martin"], "astonmartin"], [["chevrolet", "corvette"], "chevrolet"],
    [["acura"], "acura"], [["cadillac"], "cadillac"], [["toyota"], "toyota"], [["honda"], "honda"], [["audi"], "audi"], [["dallara"], "dallara"],
  ];
  return brands.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? null;
}

export default function PerformanceRanking({ items, emptyText, kind = "car" }: Props) {
  if (!items.length) return <div className="ranking-empty">{emptyText ?? "Sem dados"}</div>;
  // Ranked by average Δ iRating per race, not the raw total — a track/carro raced só 2-3 vezes pode
  // ter um total pequeno que o esconde da lista mesmo sendo pior por corrida que um contexto raced
  // 20x com total maior mas média melhor. Exige pelo menos 2 corridas para entrar no ranking (1
  // corrida só é média = resultado daquela corrida, não um padrão) — só recorre a itens de 1 corrida
  // se não houver 5 qualificados o suficiente.
  const qualified = items.filter((item) => item.races >= 2);
  const pool = qualified.length >= 4 ? qualified : items;
  const gains = [...pool].filter((item) => item.avgDelta > 0).sort((a, b) => b.avgDelta - a.avgDelta).slice(0, 5);
  const drops = [...pool].filter((item) => item.avgDelta < 0).sort((a, b) => a.avgDelta - b.avgDelta).slice(0, 5);
  const rows = [...gains, ...drops].sort((a, b) => b.avgDelta - a.avgDelta);
  const maxAbs = Math.max(...rows.map((item) => Math.abs(item.avgDelta)), 1);

  return <div className="diverging-ranking">
    <div className="diverging-axis"><span>PERDAS</span><i /><span>GANHOS</span></div>
    <p className="diverging-note">Ranking por Δ iRating médio por corrida (não o total) — assim um contexto raced poucas vezes não domina a lista à custa de um mais consistente.</p>
    {rows.map((item) => {
      const positive = item.avgDelta > 0;
      const width = Math.max(Math.abs(item.avgDelta) / maxAbs * 48, 2);
      const code = kind === "track" ? countryCode(item.label) : null;
      const brand = kind === "car" ? manufacturerSlug(item.label) : null;
      return <div className="diverging-row" key={`${item.group ?? ""}-${item.label}`}>
        <div className="diverging-label">
          {code ? <img src={`https://flagcdn.com/w20/${code}.png`} alt={`Bandeira ${code.toUpperCase()}`} width="20" height="14" /> : brand && BRAND_LOGO_OVERRIDES[brand] ? <span className="brand-icon-chip"><img className="brand-icon" src={BRAND_LOGO_OVERRIDES[brand]} alt={`Marca ${brand}`} width="14" height="14" /></span> : brand ? <span className="brand-icon-chip"><img className="brand-icon" src={`https://cdn.simpleicons.org/${brand}/1a1f26`} alt={`Marca ${brand}`} width="14" height="14" /></span> : kind === "track" ? <MapPin size={15} /> : <CarFront size={16} />}
          {item.group && <span className="performance-badge">{item.group}</span>}<strong>{item.label}</strong><small>{item.races} corridas • total {signed(item.delta)}</small>
        </div>
        <div className="diverging-bar"><i className="center-line" /><span className={positive ? "positive" : "negative"} style={positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} /></div>
        <b className={positive ? "positive" : "negative"}>{signedAvg(item.avgDelta)}/corrida</b>
      </div>;
    })}
  </div>;
}
