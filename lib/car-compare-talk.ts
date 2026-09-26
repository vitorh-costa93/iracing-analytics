import { pointsInWindow, type SectionMetrics, type SectionResult } from "./lap-analysis";
import type { RefNoun } from "./engineer-talk";
import type { Trace } from "./telemetry-trace";

/**
 * Textos e números da Comparação de carros (redesign etapa 4, 26/09/2026; Compare.dc.html). O
 * curva a curva é o mesmo da semana ativa (lib/lap-analysis.ts + lib/engineer-talk.ts), só que o
 * outro lado é um carro: "o Cadillac", "ele".
 */

/** "freia 12 m antes", "freia 4 m depois", "igual", "só você freia", "só ele freia". */
export function brakePointText(metrics: SectionMetrics): string {
  if (metrics.brakeUse === "own") return "só você freia";
  if (metrics.brakeUse === "ref") return "só ele freia";
  if (metrics.brakeUse === "none") return "sem freada";
  if (metrics.brakeDeltaMeters === null) return "igual";
  const meters = Math.round(Math.abs(metrics.brakeDeltaMeters));
  if (meters < 2) return "igual";
  return `freia ${meters} m ${metrics.brakeDeltaMeters < 0 ? "antes" : "depois"}`;
}

/** Velocidade mínima (km/h) de cada volta no miolo do trecho. */
export function sectionMinSpeeds(own: Trace, rival: Trace, section: Pick<SectionResult, "start" | "end" | "windowStart" | "windowEnd">) {
  const minIn = (trace: Trace) => {
    const core = pointsInWindow(trace.points, section.start, section.end);
    const items = core.length ? core : pointsInWindow(trace.points, section.windowStart, section.windowEnd);
    let best: number | null = null;
    for (const { point } of items) if (point.speed !== null && point.speed > 1 && (best === null || point.speed < best)) best = point.speed;
    return best === null ? null : best * 3.6;
  };
  return { own: minIn(own), rival: minIn(rival) };
}

/** A frase curta do trecho, com uma observação de microcorreções quando a diferença é clara. */
const GENERIC_GAIN = "Ponto forte, sem diferença clara nos pedais.";
const GAIN_VARIANTS = [GENERIC_GAIN, "Mesmos comandos, e o seu carro anda mais aqui.", "Ganho que vem do carro, não da pilotagem.", "Pedais parecidos; o seu carro sai na frente neste trecho."];
const GENERIC_LOSS = "Perde tempo sem um motivo claro nos pedais; confira o traçado.";
const LOSS_VARIANTS = [GENERIC_LOSS, "Pedais parecidos: a perda deve vir do carro ou do traçado.", "Sem diferença clara nos comandos; olhe o traçado no mapa."];

/** `index` varia as frases genéricas entre linhas vizinhas para a lista não repetir a mesma frase. */
export function comparePhrase(rawNote: string, microOwn: number | null, microRival: number | null, index = 0) {
  const note = rawNote === GENERIC_GAIN ? GAIN_VARIANTS[index % GAIN_VARIANTS.length] : rawNote === GENERIC_LOSS ? LOSS_VARIANTS[index % LOSS_VARIANTS.length] : rawNote;
  if (microOwn === null || microRival === null) return note;
  const diff = microOwn - microRival;
  if (diff >= 3) return `${note} Ele faz ${diff} microcorreções a menos: o carro fica mais assentado.`;
  if (diff <= -3) return `${note} Você faz ${-diff} microcorreções a menos aqui.`;
  return note;
}

/** Legenda do mapa do trecho: quem leva mais velocidade no ponto mais lento. */
export function mapCaption(label: string, speeds: { own: number | null; rival: number | null }, ref: RefNoun, fallback: string) {
  if (speeds.own !== null && speeds.rival !== null) {
    const diff = Math.round(speeds.rival - speeds.own);
    if (diff >= 2) return `${label}: ${ref.sub} mantém ${diff} km/h a mais no ponto mais lento.`;
    if (diff <= -2) return `${label}: você mantém ${-diff} km/h a mais que ${ref.sub} no ponto mais lento.`;
    return `${label}: mesma velocidade no ponto mais lento; a diferença está na entrada e na saída.`;
  }
  return `${label}: ${fallback}`;
}

/** Tom da barra de microcorreções por volta: perto do menor valor é verde. */
export function microTone(value: number | null, min: number | null): "ok" | "warn" | "bad" | "none" {
  if (value === null || min === null || min <= 0) return "none";
  const ratio = value / min;
  return ratio <= 1.1 ? "ok" : ratio <= 1.3 ? "warn" : "bad";
}

type CarMicro = { carName: string; bestLapSeconds: number; microPerLap: number | null };

/** Rodapé da tabela: liga (ou não) menos microcorreções a voltas mais rápidas, com os carros reais. */
export function microFootnote(cars: CarMicro[], shortName: (name: string) => string): string | null {
  const withMicro = cars.filter((car) => car.microPerLap !== null);
  if (withMicro.length < 2) return null;
  const fastest = cars.reduce((a, b) => (a.bestLapSeconds <= b.bestLapSeconds ? a : b));
  const calmest = withMicro.reduce((a, b) => ((a.microPerLap as number) <= (b.microPerLap as number) ? a : b));
  if (fastest.carName === calmest.carName) return `O carro mais rápido é também o que pede menos correção por volta: o ${shortName(fastest.carName)} fica mais colado ao chão.`;
  return `Menos correção nem sempre é mais rápido aqui: você corrige menos com o ${shortName(calmest.carName)}, mas a volta mais rápida saiu com o ${shortName(fastest.carName)}.`;
}
