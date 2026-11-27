import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { modelFor } from "@/lib/ai-models";
import { logAiUsage, parseOpenAiUsage } from "@/lib/ai-usage";
import { setupDisplayName } from "@/lib/setup-names";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type AssistantContext = {
  carId?: number;
  trackId?: number;
  carName?: string;
  trackName?: string;
  seasonName?: string;
  activeSetupId?: string;
  activeSetupName?: string;
  setupNames?: string[];
  proposalSummary?: string;
};

const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_COMPLETION_TOKENS = 1000;

function sanitizeImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img): img is string => typeof img === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(img) && img.length <= 2_500_000)
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}

async function loadContextSummary(ctx: AssistantContext): Promise<string> {
  const lines: string[] = [];
  if (ctx.carName || ctx.trackName) {
    lines.push(`Contexto selecionado no Setup Lab: ${ctx.carName ?? "Carro não selecionado"} · ${ctx.trackName ?? "Pista não selecionada"}${ctx.seasonName ? ` (${ctx.seasonName})` : ""}.`);
  }
  if (ctx.activeSetupName) {
    lines.push(`Setup ativo no seletor: ${ctx.activeSetupName}.`);
  }
  if (ctx.setupNames?.length) {
    lines.push(`Setups disponíveis neste contexto: ${ctx.setupNames.slice(0, 12).join(", ")}.`);
  }
  if (ctx.proposalSummary) {
    lines.push(`Última proposta no painel Setup B: ${ctx.proposalSummary}`);
  }

  try {
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (driver && Number.isInteger(ctx.carId) && Number.isInteger(ctx.trackId)) {
      const [racesRes, setupRes] = await Promise.all([
        supabaseAdmin
          .from("race_results")
          .select("raced_at,finish_position,start_position,irating_delta,incidents,best_lap_time")
          .eq("driver_id", driver.id)
          .eq("car_id", ctx.carId!)
          .eq("track_id", ctx.trackId!)
          .order("raced_at", { ascending: false })
          .limit(5),
        ctx.activeSetupId
          ? supabaseAdmin
              .from("setup_files")
              .select("filename,decoded_params")
              .eq("id", ctx.activeSetupId)
              .eq("driver_id", driver.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const races = racesRes.data ?? [];
      if (races.length > 0) {
        lines.push(
          "Últimas corridas do piloto nesta combinação:",
          ...races.map((r) => {
            const date = r.raced_at ? new Date(r.raced_at).toLocaleDateString("pt-BR") : "?";
            const pos = r.finish_position != null ? `P${r.finish_position}` : "P?";
            const grid = r.start_position != null ? ` (largou P${r.start_position})` : "";
            const delta = r.irating_delta != null ? `, Δ iR ${r.irating_delta >= 0 ? "+" : ""}${r.irating_delta}` : "";
            const inc = r.incidents != null ? `, ${r.incidents}x` : "";
            const best = r.best_lap_time ? `, melhor ${r.best_lap_time}` : "";
            return `- ${date}: ${pos}${grid}${delta}${inc}${best}`;
          })
        );
      }

      const decoded = setupRes.data?.decoded_params as Array<{ label?: string; value?: string }> | null | undefined;
      if (Array.isArray(decoded) && decoded.length > 0) {
        const sample = decoded
          .filter((row) => row?.label && row?.value)
          .slice(0, 45)
          .map((row) => `${row.label}: ${row.value}`)
          .join(" | ");
        lines.push(`Parâmetros lidos de ${setupDisplayName(String(setupRes.data?.filename ?? "setup"))}: ${sample}`);
      }
    }
  } catch {
    // Falha ao enriquecer contexto do Supabase não impede o chatbot de responder.
  }

  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const model = modelFor("engineer");
  try {
    const apiKey = process.env.OPENAI_KEY;
    if (!apiKey) {
      return NextResponse.json({ status: "error", message: "OPENAI_KEY não configurada." }, { status: 500 });
    }

    const body = (await request.json()) as { messages?: AssistantMessage[]; context?: AssistantContext };
    const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    const normalized = rawMessages
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.trim().slice(0, MAX_MESSAGE_LENGTH) : "",
        images: m.role === "user" ? sanitizeImages(m.images) : [],
      }))
      .filter((m) => m.content.length > 0 || m.images.length > 0);

    if (normalized.length === 0) {
      return NextResponse.json({ status: "error", message: "Envie uma mensagem ou imagem para o assistente." }, { status: 400 });
    }

    // Envia imagens apenas das 2 últimas mensagens do usuário para manter latência e custo sob controle.
    let userImageTurns = 0;
    const keepImagesAt = new Set<number>();
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].role === "user" && normalized[i].images.length > 0 && userImageTurns < 2) {
        keepImagesAt.add(i);
        userImageTurns += 1;
      }
    }

    const contextSummary = await loadContextSummary(body.context ?? {});
    const systemPrompt = [
      "Você é o Assistente IA de Setup do Racing Analytics (engenheiro de pista de iRacing).",
      "Responda sempre em português do Brasil, de forma objetiva, prática e sem jargão desnecessário.",
      "Ajude com ajustes de setup (aero, barras, molas, amortecedores, diferencial, pressão/cambagem, freio), análise de prints da garagem do iRacing enviados pelo usuário, interpretação de comportamento do carro (subesterço, sobresterço, tração, frenagem) e estratégia de treino/corrida.",
      "Quando o usuário enviar prints de setup ou telemetria, leia os valores visíveis e sugira ajustes concretos passo a passo (indicando direção do ajuste, o que melhora e possível efeito colateral).",
      "Se algum parâmetro não estiver visível nem nos dados abaixo, diga claramente em vez de inventar.",
      contextSummary ? `\nContexto atual:\n${contextSummary}` : "",
    ].filter(Boolean).join("\n");

    const openAiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...normalized.map((msg, idx) => {
        if (msg.role === "user" && keepImagesAt.has(idx)) {
          const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];
          if (msg.content) parts.push({ type: "text", text: msg.content });
          for (const url of msg.images) {
            parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
          }
          return { role: "user" as const, content: parts };
        }
        return { role: msg.role, content: msg.content };
      }),
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: openAiMessages,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: unknown;
      error?: { message?: string };
    };

    if (!response.ok) {
      await logAiUsage({ task: "engineer", model, ok: false, durationMs: Date.now() - t0, error: data.error?.message ?? `HTTP ${response.status}` });
      return NextResponse.json({ status: "error", message: data.error?.message ?? "Erro ao consultar o assistente de IA." }, { status: 502 });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      await logAiUsage({ task: "engineer", model, ok: false, durationMs: Date.now() - t0, error: "empty_reply" });
      return NextResponse.json({ status: "error", message: "O assistente não retornou resposta." }, { status: 502 });
    }

    const usage = parseOpenAiUsage(data.usage);
    await logAiUsage({ task: "engineer", model, ok: true, durationMs: Date.now() - t0, ...usage });

    return NextResponse.json({ status: "ok", reply });
  } catch (error) {
    await logAiUsage({ task: "engineer", model, ok: false, durationMs: Date.now() - t0, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ status: "error", message: "Não foi possível consultar o assistente agora." }, { status: 500 });
  }
}
