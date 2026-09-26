import { unwrapIntoWindow } from "./corner-sequences";

/**
 * Microcorreções de volante (redesign etapa 4, 26/09/2026).
 *
 * DEFINIÇÃO: uma microcorreção é uma inversão rápida do sentido do volante, com o carro andando.
 * Conta-se cada ponto de virada do ângulo do volante (esquerda → direita ou o contrário) em que:
 *   1. o volante volta pelo menos MICRO_HYSTERESIS_DEG graus a partir do extremo (histerese: filtra
 *      tremida de force feedback e zebra, que ficam em 1–2°);
 *   2. o movimento que TERMINA nesse ponto de virada durou no máximo MICRO_MAX_SWING_SECONDS (uma
 *      entrada de curva normal é um giro longo e contínuo; uma correção é curta e brusca);
 *   3. o carro está a pelo menos MICRO_MIN_SPEED_KMH (fora de box, largada parada e rodada).
 * O sinal é reamostrado numa grade de tempo fixa de MICRO_GRID_HZ antes de contar, para o número não
 * depender da taxa de amostragem da fonte (CSV do Garage61 a 60 Hz, referência IBT reduzida a ~25 Hz):
 * na validação (3 voltas reais da Ferrari 499P em Road Atlanta, 26/09/2026) a contagem a partir de
 * 60 Hz e a partir de 20 Hz ficou a menos de 10% uma da outra com estes limiares, e deu 28–48 por
 * volta de 70 s (~25–40 por minuto), coerente com o que um piloto sente como "mexer no volante".
 *
 * O tempo de cada amostra vem da própria volta: Σ(Δdistância / velocidade), reescalado para somar o
 * tempo oficial da volta. Por isso a métrica precisa do traço em resolução cheia (não o traço
 * decimado de ~900 pontos do navegador) e do tempo da volta.
 *
 * Taxas: por minuto de volta cronometrada (Race Debrief) e por volta (Comparação de carros). Menos é
 * melhor, mas só compare o mesmo carro/pista ou pistas iguais: uma pista travada tem mais volante.
 */
export const MICRO_HYSTERESIS_DEG = 4;
export const MICRO_MAX_SWING_SECONDS = 0.5;
export const MICRO_MIN_SPEED_KMH = 60;
export const MICRO_GRID_HZ = 20;

export type SteeringSample = { distance: number; speed: number | null | undefined; steering: number | null | undefined };

export type MicrocorrectionResult = {
  count: number;
  perMinute: number;
  /** distância (% da volta) de cada microcorreção contada, para contar por trecho depois */
  distances: number[];
};

type GridPoint = { t: number; distance: number; speed: number; steering: number };

/** Reamostra a volta numa grade de tempo fixa. Amostras sem velocidade ou volante são ignoradas. */
export function resampleByTime(samples: SteeringSample[], lapTimeSeconds: number, hz = MICRO_GRID_HZ): GridPoint[] {
  const points = samples
    .filter((sample): sample is { distance: number; speed: number; steering: number } =>
      Number.isFinite(sample.distance) && Number.isFinite(sample.speed as number) && Number.isFinite(sample.steering as number))
    .sort((a, b) => a.distance - b.distance);
  if (points.length < 10 || !(lapTimeSeconds > 0)) return [];
  const raw = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dd = Math.max(0, points[i].distance - points[i - 1].distance);
    const speed = Math.max(1, (points[i].speed + points[i - 1].speed) / 2);
    total += dd / speed;
    raw.push(total);
  }
  if (total <= 0) return [];
  const scale = lapTimeSeconds / total;
  const times = raw.map((value) => value * scale);
  const grid: GridPoint[] = [];
  let j = 0;
  const end = times[times.length - 1];
  for (let t = 0; t <= end; t += 1 / hz) {
    while (j < times.length - 2 && times[j + 1] < t) j += 1;
    const span = Math.max(1e-9, times[j + 1] - times[j]);
    const ratio = Math.min(1, Math.max(0, (t - times[j]) / span));
    const a = points[j], b = points[j + 1];
    grid.push({
      t,
      distance: a.distance + (b.distance - a.distance) * ratio,
      speed: a.speed + (b.speed - a.speed) * ratio,
      steering: a.steering + (b.steering - a.steering) * ratio,
    });
  }
  return grid;
}

/** Conta as microcorreções de UMA volta (ver a definição no topo do arquivo). */
export function detectMicrocorrections(samples: SteeringSample[], lapTimeSeconds: number): MicrocorrectionResult {
  const grid = resampleByTime(samples, lapTimeSeconds);
  if (grid.length < 3) return { count: 0, perMinute: 0, distances: [] };
  const hysteresis = (MICRO_HYSTERESIS_DEG * Math.PI) / 180;
  const minSpeed = MICRO_MIN_SPEED_KMH / 3.6;
  const distances: number[] = [];

  let direction = 0;
  let extreme = grid[0].steering;
  let extremeIndex = 0;
  let lastTurnTime = grid[0].t;
  for (let i = 1; i < grid.length; i += 1) {
    const value = grid[i].steering;
    if (direction === 0) {
      if (Math.abs(value - grid[0].steering) >= hysteresis) { direction = value > grid[0].steering ? 1 : -1; extreme = value; extremeIndex = i; }
      continue;
    }
    if ((direction > 0 && value > extreme) || (direction < 0 && value < extreme)) { extreme = value; extremeIndex = i; }
    const backtrack = direction > 0 ? extreme - value : value - extreme;
    if (backtrack >= hysteresis) {
      const turn = grid[extremeIndex];
      if (turn.t - lastTurnTime <= MICRO_MAX_SWING_SECONDS && turn.speed >= minSpeed) distances.push(Number(turn.distance.toFixed(2)));
      lastTurnTime = turn.t;
      direction = -direction;
      extreme = value;
      extremeIndex = i;
    }
  }
  const minutes = lapTimeSeconds / 60;
  return { count: distances.length, perMinute: minutes > 0 ? distances.length / minutes : 0, distances };
}

/** Quantas microcorreções caem dentro de uma janela de trecho (distância desenrolada, ex.: -2 a 5). */
export function countInWindow(distances: number[], windowStart: number, windowEnd: number) {
  return distances.reduce((sum, distance) => (unwrapIntoWindow(distance, windowStart, windowEnd) !== null ? sum + 1 : sum), 0);
}

/** Média de várias voltas: soma de microcorreções / soma dos minutos (volta longa pesa mais). */
export function summarizeMicrocorrections(laps: { result: MicrocorrectionResult; lapTimeSeconds: number }[]) {
  const valid = laps.filter((lap) => lap.lapTimeSeconds > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, lap) => sum + lap.result.count, 0);
  const minutes = valid.reduce((sum, lap) => sum + lap.lapTimeSeconds / 60, 0);
  return {
    laps: valid.length,
    perLap: Number((total / valid.length).toFixed(1)),
    perMinute: Number((total / minutes).toFixed(1)),
  };
}
