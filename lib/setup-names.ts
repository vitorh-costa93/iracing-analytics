// Nomes em linguagem de piloto para setups e parâmetros do Setup Lab (redesign etapa 6).
// O Garage61 entrega rótulos do iRacing em inglês ("ARB Blades", seção "Left Front"); o piloto não
// precisa ler "Chassis • Left Front • ARB Blades" na conversa. Tudo aqui é determinístico e puro.

/** Nome curto de um setup: sem pasta de season ("26S4\\...") e sem extensão. Nunca devolve caminho. */
export function setupDisplayName(filename: string): string {
  const last = filename.split(/[\\/]/).filter(Boolean).pop() ?? filename;
  const clean = last.replace(/\.sto$/i, "").replace(/_/g, " ").replace(/\s{2,}/g, " ").trim();
  return clean || "Setup";
}

/** Origem do setup em uma palavra, como no mockup ("Garage61", "importado"). */
export function setupSourceLabel(source: string | null | undefined): string {
  return source === "garage61" ? "Garage61" : "importado";
}

type Position = { axle: "front" | "rear" | null; side: "left" | "right" | null };

export function positionOf(section: string | undefined, label: string): Position {
  const key = `${section ?? ""} ${label}`.toLowerCase();
  const axle = /\bfront\b|diant|\blf\b|\brf\b/.test(key) ? "front" : /\brear\b|trase|\blr\b|\brr\b/.test(key) ? "rear" : null;
  const side = /\bleft\b|esquerd|\blf\b|\blr\b/.test(key) ? "left" : /\bright\b|direit|\brf\b|\brr\b/.test(key) ? "right" : null;
  return { axle, side };
}

function positionWords(position: Position, feminine: boolean): string {
  const axle = position.axle === "front" ? (feminine ? "dianteira" : "dianteiro") : position.axle === "rear" ? (feminine ? "traseira" : "traseiro") : "";
  const side = position.side === "left" ? (feminine ? "esquerda" : "esquerdo") : position.side === "right" ? (feminine ? "direita" : "direito") : "";
  return [axle, side].filter(Boolean).join(" ");
}

// [padrão no rótulo, nome em português, feminino?, usa posição?]
const NAMES: Array<[RegExp, string, boolean, boolean]> = [
  [/brake.*bias|bias.*brake|brake pressure bias/, "Distribuição de freio (brake bias)", true, false],
  [/anti.?roll|\barb\b/, "Barra estabilizadora", true, true],
  [/rear.*wing|wing.*(angle|setting)|^wing$/, "Asa traseira", true, false],
  [/front.*(wing|flap)|flap/, "Asa dianteira", true, false],
  [/splitter/, "Splitter", false, false],
  [/gurney/, "Gurney", false, false],
  [/last.*hot.*press|hot.*press/, "Pressão quente medida", true, true],
  [/last.*temp/, "Temperatura medida do pneu", true, true],
  [/tread|wear|remaining/, "Pneu restante", false, true],
  [/(heave|3rd|third).*(gap|defl)/, "Folga da mola central", true, true],
  [/(heave|3rd|third).*perch/, "Pré-carga da mola central", true, true],
  [/heave.*spring|third.*spring|3rd.*spring/, "Mola central (heave)", true, true],
  [/spring.*perch|perch/, "Pré-carga da mola", true, true],
  [/spring/, "Mola", true, true],
  [/bump.*stop|packer/, "Batente", false, true],
  [/ride.?height/, "Altura", true, true],
  [/camber/, "Cambagem", true, true],
  [/toe/, "Convergência (toe)", true, true],
  [/caster/, "Cáster", false, true],
  [/compound/, "Composto do pneu", false, false],
  [/(ls|low.?speed).*(comp|bump)/, "Amortecedor de compressão lenta", false, true],
  [/(hs|high.?speed).*(comp|bump)/, "Amortecedor de compressão rápida", false, true],
  [/(ls|low.?speed).*reb/, "Amortecedor de extensão lenta", false, true],
  [/(hs|high.?speed).*reb/, "Amortecedor de extensão rápida", false, true],
  [/comp|bump/, "Amortecedor de compressão", false, true],
  [/reb/, "Amortecedor de extensão", false, true],
  [/preload/, "Pré-carga do diferencial", true, false],
  [/coast/, "Diferencial na desaceleração (coast)", false, false],
  [/drive.*angle|power.*ramp/, "Diferencial na aceleração (drive)", false, false],
  [/ramp/, "Ângulo de rampa do diferencial", false, false],
  [/clutch|friction.*plate/, "Discos do diferencial", false, false],
  [/(cold|starting).*press|tire.*press|tyre.*press|^pressure/, "Pressão do pneu", true, true],
  [/traction.*control|\btc\b/, "Controle de tração", false, false],
  [/\babs\b/, "ABS", false, false],
  [/fuel/, "Combustível", false, false],
  [/brake.*duct|duct/, "Duto de freio", false, true],
  [/master.*cyl/, "Cilindro mestre do freio", false, true],
  [/pad/, "Pastilha de freio", true, true],
  [/gear|ratio/, "Relação de marcha", true, false],
];

/** Nome do parâmetro em português, com eixo/lado quando fizer sentido ("Barra estabilizadora dianteira"). */
export function plainParameterName(label: string, section?: string): string {
  const key = label.toLowerCase();
  const found = NAMES.find(([pattern]) => pattern.test(key));
  if (!found) {
    const words = positionWords(positionOf(section, label), false);
    return words && !/front|rear|left|right/i.test(label) ? `${label} (${words})` : label;
  }
  const [, name, feminine, usesPosition] = found;
  if (!usesPosition) return name;
  const words = positionWords(positionOf(section, label), feminine);
  if (!words) return name;
  // "Convergência (toe)" + posição fica "Convergência dianteira (toe)".
  const paren = name.match(/^(.*?)( \(.*\))$/);
  return paren ? `${paren[1]} ${words}${paren[2]}` : `${name} ${words}`;
}

/** Nomes curtos para a fala de uma comparação: tira as palavras que os dois nomes têm em comum
 * ("TS 26S4 SF23 W01 Interlagos Quali" × "... Race" vira "Quali" × "Race") e o código de season/week
 * (26S4, W01). Se sobrar nada ou os dois ficarem iguais, devolve os nomes inteiros. */
export function shortPairNames(a: string, b: string): [string, string] {
  const words = (value: string) => value.split(/s+/).filter(Boolean);
  const noise = (word: string) => /^d{2}Sd$/i.test(word) || /^Wd{1,2}$/i.test(word);
  const setA = new Set(words(a).map((word) => word.toLowerCase()));
  const setB = new Set(words(b).map((word) => word.toLowerCase()));
  const keep = (value: string, other: Set<string>) => words(value).filter((word) => !other.has(word.toLowerCase()) && !noise(word)).join(" ");
  const shortA = keep(a, setB), shortB = keep(b, setA);
  if (!shortA || !shortB || shortA.toLowerCase() === shortB.toLowerCase()) return [a, b];
  return [shortA, shortB];
}

/** Agrupamento do painel A/B (mais grosso que as categorias do diff, como no mockup). */
export const PANEL_GROUPS: Record<string, string> = {
  arb: "Suspensão", springs: "Suspensão", dampers: "Suspensão", ride_height: "Suspensão", alignment: "Suspensão",
  aero: "Aerodinâmica", brakes: "Freios", differential: "Diferencial", tires: "Pneus", gearing: "Câmbio",
  display: "Painel", other: "Outros",
};
export const PANEL_GROUP_ORDER = ["Suspensão", "Aerodinâmica", "Freios", "Diferencial", "Pneus", "Câmbio", "Outros", "Painel"];
