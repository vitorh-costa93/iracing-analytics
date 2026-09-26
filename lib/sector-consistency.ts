/**
 * Consistência por setor pelo critério RELATIVO de 94c4d8d:app/api/telemetry/sectors/route.ts
 * (auditoria B, 26/09/2026): o desvio padrão do setor dividido pelo tempo médio do setor.
 *   < 0,3%  muito consistente
 *   < 0,8%  consistente
 *   < 1,6%  variável
 *   senão   muito inconsistente
 * Assim um setor de 60 s pode variar o dobro de um de 30 s e ainda ser "muito consistente", o que o
 * limite absoluto em segundos (0,15/0,30 s, usado na primeira versão do Night Grid) não fazia.
 */
export type SectorConsistency = "muito consistente" | "consistente" | "variável" | "muito inconsistente";

export const SECTOR_CONSISTENCY_LIMITS = { great: 0.003, good: 0.008, variable: 0.016 } as const;

export function sectorSpreadRatio(sd: number, avg: number) {
  return avg > 0 ? sd / avg : 0;
}

export function consistencyLabel(sd: number, avg: number): SectorConsistency {
  const ratio = sectorSpreadRatio(sd, avg);
  return ratio < SECTOR_CONSISTENCY_LIMITS.great ? "muito consistente" : ratio < SECTOR_CONSISTENCY_LIMITS.good ? "consistente" : ratio < SECTOR_CONSISTENCY_LIMITS.variable ? "variável" : "muito inconsistente";
}

/** Tom da barra: os dois níveis consistentes em verde, variável em amarelo, muito inconsistente em vermelho. */
export function consistencyTone(label: SectorConsistency): "ok" | "warn" | "bad" {
  return label === "muito consistente" || label === "consistente" ? "ok" : label === "variável" ? "warn" : "bad";
}
