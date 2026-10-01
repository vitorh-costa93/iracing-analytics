import { supabaseAdmin } from "@/lib/supabase-admin";
import { estimateCostUsd, type AiTask } from "@/lib/ai-models";

export interface UsageRecord {
  task: AiTask;
  model: string;
  ok: boolean;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** Sobrescreve a estimativa por tokens. */
  costUsd?: number | null;
  durationMs?: number;
  error?: string;
}

/** Lê o objeto `usage` de uma resposta da OpenAI (chat completions ou responses). */
export function parseOpenAiUsage(usage: unknown): Pick<UsageRecord, "inputTokens" | "cachedTokens" | "outputTokens" | "reasoningTokens"> {
  const u = (usage ?? {}) as Record<string, any>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(u.prompt_tokens ?? u.input_tokens),
    cachedTokens: num((u.prompt_tokens_details ?? u.input_tokens_details)?.cached_tokens),
    outputTokens: num(u.completion_tokens ?? u.output_tokens),
    reasoningTokens: num((u.completion_tokens_details ?? u.output_tokens_details)?.reasoning_tokens),
  };
}

/** Teto mensal em US$ (AI_MONTHLY_CAP_USD). Só AVISA: nunca bloqueia nenhuma chamada. */
function monthlyCap(): number {
  const n = Number(process.env.AI_MONTHLY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Registra uma chamada de IA. Nunca lança: falha de log não pode derrubar a funcionalidade. */
export async function logAiUsage(rec: UsageRecord): Promise<void> {
  try {
    const usage = {
      inputTokens: rec.inputTokens ?? 0,
      cachedTokens: rec.cachedTokens ?? 0,
      outputTokens: rec.outputTokens ?? 0,
    };
    const cost = rec.costUsd !== undefined ? rec.costUsd : estimateCostUsd(rec.model, usage);
    const { error } = await supabaseAdmin.from("ai_usage").insert({
      task: rec.task,
      model: rec.model,
      ok: rec.ok,
      input_tokens: usage.inputTokens,
      cached_tokens: usage.cachedTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: rec.reasoningTokens ?? 0,
      cost_usd: cost,
      duration_ms: rec.durationMs ?? null,
      error: rec.error?.slice(0, 300) ?? null,
    });
    if (error) {
      console.error("logAiUsage: falha ao gravar", error.message);
      return;
    }
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { data, error: sumError } = await supabaseAdmin.from("ai_usage").select("cost_usd").gte("created_at", start.toISOString());
    if (sumError) return;
    const spent = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
    const cap = monthlyCap();
    if (spent >= cap) console.warn(`[ai] gasto estimado do mês US$ ${spent.toFixed(2)} passou do teto US$ ${cap.toFixed(2)}`);
  } catch (error) {
    console.error("logAiUsage failed:", error);
  }
}
