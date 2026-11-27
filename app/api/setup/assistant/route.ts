import { NextRequest, NextResponse } from "next/server";
import { modelFor } from "@/lib/ai-models";
import { logAiUsage, parseOpenAiUsage } from "@/lib/ai-usage";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
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

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const model = modelFor("engineer");
  try {
    const apiKey = process.env.OPENAI_KEY;
    if (!apiKey) {
      return NextResponse.json({ status: "error", message: "OPENAI_KEY não configurada." }, { status: 500 });
    }

    const body = (await request.json()) as { messages?: AssistantMessage[] };
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

    const systemPrompt = [
      "Você é o Assistente IA do Racing Analytics (chatbot geral de engenharia de pista e setup para iRacing, independente da seleção de carro/pista da tela).",
      "Responda sempre em português do Brasil, de forma objetiva, prática e sem jargão desnecessário.",
      "Ajude com dúvidas livres sobre dinâmica veicular e ajustes de setup (aero, barras, molas, amortecedores, diferencial, pressão/cambagem, freio), análise de prints da garagem do iRacing enviados pelo usuário, comportamento do carro (subesterço, sobresterço, tração, frenagem) e estratégia de treino/corrida.",
      "Quando o usuário enviar prints de setup ou telemetria, leia os valores visíveis e sugira ajustes concretos passo a passo (indicando direção do ajuste, o que melhora e possível efeito colateral).",
      "Se o usuário não informar o carro ou pista na conversa e isso for essencial para um ajuste específico, pergunte ou explique os princípios aplicáveis de forma clara, sem inventar parâmetros.",
    ].join("\n");

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
