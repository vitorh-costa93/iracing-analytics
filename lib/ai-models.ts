// Camada central de modelos de IA: um lugar só para escolher modelo por tarefa e estimar custo.
// Decisão de 01/10/2026 (farmacia-uailazo/docs/CUSTOS-OPENAI-TESTES.md): texto/visão = gpt-6-luna;
// imagem = gpt-image-2.5-flare em qualidade medium. Mesma tabela PRICES do meudinheiro.
// Override sem deploy de código: variável de ambiente AI_MODEL_<TAREFA> (ex.: AI_MODEL_ENGINEER).

export type AiTask = "engineer" | "extraction" | "vision" | "insight" | "transcription" | "image";

const DEFAULT_MODELS: Record<AiTask, string> = {
  engineer: "gpt-6-luna",
  extraction: "gpt-6-luna",
  vision: "gpt-6-luna",
  insight: "gpt-6-luna",
  transcription: "whisper-1",
  image: "gpt-image-2.5-flare",
};

export function modelFor(task: AiTask): string {
  return process.env[`AI_MODEL_${task.toUpperCase()}`]?.trim() || DEFAULT_MODELS[task];
}

// US$ por 1M de tokens: [entrada, entrada em cache, saída]. Lidos em 01/10/2026 (CONFERIR em
// platform.openai.com/docs/pricing). gpt-6-luna: cache assumido em 10% da entrada (não confirmado).
// Custo guardado é ESTIMADO; o valor faturado só aparece em Costs na plataforma da OpenAI.
const PRICES: Record<string, [number, number, number]> = {
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.6-terra": [2, 0.2, 12],
  "gpt-6.1-sol": [2, 0.2, 10],
  "gpt-4o-mini": [0.15, 0.075, 0.6],
  "gpt-image-2.5-flare": [5, 1.25, 30],
  "gpt-image-2": [5, 1.25, 30],
  "gpt-image-1.5": [5, 1.25, 32],
  "gpt-image-1": [5, 1.25, 40],
};

export interface TokenUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** Custo estimado em US$; null quando o modelo não tem preço na tabela (guarda só os tokens). */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const fresh = Math.max(usage.inputTokens - usage.cachedTokens, 0);
  return (fresh / 1e6) * p[0] + (usage.cachedTokens / 1e6) * p[1] + (usage.outputTokens / 1e6) * p[2];
}
