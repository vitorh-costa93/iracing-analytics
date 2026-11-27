import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { modelFor } from "@/lib/ai-models";
import { logAiUsage, parseOpenAiUsage } from "@/lib/ai-usage";
import { setupDisplayName } from "@/lib/setup-names";
import { categoryOf, diffSetups, type DecodedRow } from "@/lib/setup-diff";

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
const MAX_COMPLETION_TOKENS = 1400;
const MAX_TOOL_ROUNDS = 4;

function sanitizeImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img): img is string => typeof img === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(img) && img.length <= 2_500_000)
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_setups",
      description: "Lista os setups do piloto na base de dados (de todos os carros e pistas), podendo filtrar por carro, pista ou tipo (fixed, commercial, open, unknown).",
      parameters: {
        type: "object",
        properties: {
          car_query: { type: "string", description: "Filtro parcial pelo nome do carro (ex.: 'Porsche 963', 'GT3', 'SF23')." },
          track_query: { type: "string", description: "Filtro parcial pelo nome da pista (ex.: 'Sebring', 'Silverstone', 'Spa')." },
          setup_kind: { type: "string", enum: ["fixed", "commercial", "open", "unknown"], description: "Filtrar por tipo de setup." },
          only_decoded: { type: "boolean", description: "Se true, retorna apenas setups que já possuem parâmetros decodificados para leitura/comparação." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_or_compare_setups",
      description: "Lê os parâmetros reais de 1 ou mais setups (até 6) ou compara padrões entre todos os setups decodificados de um carro (ex.: fixo vs. comerciais em várias pistas).",
      parameters: {
        type: "object",
        properties: {
          setup_ids: { type: "array", items: { type: "string" }, description: "IDs específicos de setups retornados por list_setups (até 6)." },
          car_query: { type: "string", description: "Se setup_ids não for informado, busca até 6 setups decodificados deste carro (priorizando incluir fixed e commercial)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_race_history",
      description: "Consulta o histórico de corridas do piloto (posição, largada, Δ iRating, incidentes, melhor volta) filtrando por carro, pista ou categoria.",
      parameters: {
        type: "object",
        properties: {
          car_query: { type: "string", description: "Filtro parcial pelo nome do carro." },
          track_query: { type: "string", description: "Filtro parcial pelo nome da pista." },
          category: { type: "string", enum: ["sports_car", "formula_car"], description: "Categoria de licença." },
          limit: { type: "integer", description: "Quantidade máxima de corridas (padrão 15, máximo 40)." },
        },
      },
    },
  },
] as const;

type CatalogMaps = {
  driverId: string;
  driverName: string;
  cars: Map<number, string>;
  tracks: Map<number, string>;
};

async function loadCatalog(): Promise<CatalogMaps> {
  const { data: driver, error } = await supabaseAdmin
    .from("drivers")
    .select("id,name")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !driver) throw new Error("Piloto não encontrado na base.");

  const [carsRes, tracksRes] = await Promise.all([
    supabaseAdmin.from("cars").select("id,name"),
    supabaseAdmin.from("tracks").select("id,name,variant"),
  ]);
  const cars = new Map<number, string>((carsRes.data ?? []).map((c) => [Number(c.id), String(c.name)]));
  const tracks = new Map<number, string>(
    (tracksRes.data ?? []).map((t) => [Number(t.id), `${t.name}${t.variant ? ` (${t.variant})` : ""}`])
  );
  return { driverId: String(driver.id), driverName: String(driver.name ?? "Piloto"), cars, tracks };
}

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

async function runTool(name: string, rawArgs: string, catalog: CatalogMaps): Promise<string> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArgs || "{}") as Record<string, unknown>; } catch { args = {}; }

  if (name === "list_setups") {
    const carQ = norm(args.car_query);
    const trackQ = norm(args.track_query);
    const kind = norm(args.setup_kind);
    const onlyDecoded = Boolean(args.only_decoded);

    let query = supabaseAdmin
      .from("setup_files")
      .select("id,car_id,track_id,season_id,setup_kind,source,filename,decoded_at,created_at")
      .eq("driver_id", catalog.driverId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (kind) query = query.eq("setup_kind", kind);
    if (onlyDecoded) query = query.not("decoded_params", "is", null);

    const { data, error } = await query;
    if (error) return JSON.stringify({ error: error.message });

    const items = (data ?? [])
      .map((row) => ({
        id: String(row.id),
        name: setupDisplayName(String(row.filename ?? "")),
        car: catalog.cars.get(Number(row.car_id)) ?? `Carro ${row.car_id}`,
        track: catalog.tracks.get(Number(row.track_id)) ?? `Pista ${row.track_id}`,
        setup_kind: String(row.setup_kind ?? "unknown"),
        source: String(row.source ?? ""),
        season_id: row.season_id != null ? String(row.season_id) : null,
        decoded: Boolean(row.decoded_at),
      }))
      .filter((item) => (!carQ || item.car.toLowerCase().includes(carQ)) && (!trackQ || item.track.toLowerCase().includes(trackQ)));

    return JSON.stringify({ total_matched: items.length, setups: items.slice(0, 40) });
  }

  if (name === "inspect_or_compare_setups") {
    const setupIds = Array.isArray(args.setup_ids)
      ? args.setup_ids.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 6)
      : [];
    const carQ = norm(args.car_query);

    let rows: Array<{ id: string; car_id: number; track_id: number; setup_kind: string; source: string; filename: string; decoded_params: DecodedRow[] | null }> = [];
    if (setupIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("setup_files")
        .select("id,car_id,track_id,setup_kind,source,filename,decoded_params")
        .eq("driver_id", catalog.driverId)
        .in("id", setupIds);
      if (error) return JSON.stringify({ error: error.message });
      rows = (data ?? []) as typeof rows;
    } else {
      const { data, error } = await supabaseAdmin
        .from("setup_files")
        .select("id,car_id,track_id,setup_kind,source,filename,decoded_params")
        .eq("driver_id", catalog.driverId)
        .not("decoded_params", "is", null)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) return JSON.stringify({ error: error.message });
      const filtered = ((data ?? []) as typeof rows).filter((r) => {
        const carName = (catalog.cars.get(Number(r.car_id)) ?? "").toLowerCase();
        return !carQ || carName.includes(carQ);
      });
      // Prioriza incluir variedade: até 2 fixed + até 4 commercial/outros.
      const fixed = filtered.filter((r) => r.setup_kind === "fixed").slice(0, 2);
      const others = filtered.filter((r) => r.setup_kind !== "fixed").slice(0, 6 - fixed.length);
      rows = [...fixed, ...others];
    }

    const valid = rows.filter((r) => Array.isArray(r.decoded_params) && r.decoded_params.length > 0);
    if (valid.length === 0) {
      return JSON.stringify({ message: "Nenhum setup com parâmetros decodificados encontrado para os filtros informados." });
    }

    if (valid.length === 1) {
      const s = valid[0];
      const params = (s.decoded_params ?? [])
        .filter((p) => p.label && p.metric_value !== undefined && categoryOf(String(p.label), String(p.section ?? "")) !== "display")
        .slice(0, 80)
        .map((p) => ({
          section: p.section ?? "",
          label: p.label ?? "",
          value: String(p.metric_value),
          category: categoryOf(String(p.label), String(p.section ?? "")),
        }));
      return JSON.stringify({
        setup: {
          id: s.id,
          name: setupDisplayName(s.filename),
          car: catalog.cars.get(Number(s.car_id)) ?? `Carro ${s.car_id}`,
          track: catalog.tracks.get(Number(s.track_id)) ?? `Pista ${s.track_id}`,
          setup_kind: s.setup_kind,
        },
        parameters: params,
      });
    }

    // Para 2+ setups: usa o primeiro como base e compara os demais via diffSetups para evidenciar padrões.
    const base = valid[0];
    const baseName = setupDisplayName(base.filename);
    const comparisons = valid.slice(1).map((target) => {
      const diff = diffSetups(base.decoded_params ?? [], target.decoded_params ?? []);
      return {
        compared_to: {
          id: target.id,
          name: setupDisplayName(target.filename),
          car: catalog.cars.get(Number(target.car_id)) ?? `Carro ${target.car_id}`,
          track: catalog.tracks.get(Number(target.track_id)) ?? `Pista ${target.track_id}`,
          setup_kind: target.setup_kind,
        },
        settable_changes: diff
          .filter((c) => c.settable)
          .slice(0, 45)
          .map((c) => ({ category: c.category, section: c.section, label: c.label, base: c.before, target: c.after })),
      };
    });

    return JSON.stringify({
      base: {
        id: base.id,
        name: baseName,
        car: catalog.cars.get(Number(base.car_id)) ?? `Carro ${base.car_id}`,
        track: catalog.tracks.get(Number(base.track_id)) ?? `Pista ${base.track_id}`,
        setup_kind: base.setup_kind,
      },
      comparisons,
    });
  }

  if (name === "query_race_history") {
    const carQ = norm(args.car_query);
    const trackQ = norm(args.track_query);
    const category = norm(args.category);
    const limit = Math.min(40, Math.max(1, Number(args.limit) || 15));

    let query = supabaseAdmin
      .from("race_results")
      .select("raced_at,car_id,track_id,series_name,rating_category,start_position,finish_position,irating_delta,incidents,best_lap_time")
      .eq("driver_id", catalog.driverId)
      .order("raced_at", { ascending: false })
      .limit(250);
    if (category) query = query.eq("rating_category", category);

    const { data, error } = await query;
    if (error) return JSON.stringify({ error: error.message });

    const races = (data ?? [])
      .map((r) => ({
        date: r.raced_at ? new Date(String(r.raced_at)).toISOString().slice(0, 10) : null,
        car: catalog.cars.get(Number(r.car_id)) ?? `Carro ${r.car_id}`,
        track: catalog.tracks.get(Number(r.track_id)) ?? `Pista ${r.track_id}`,
        series: String(r.series_name ?? ""),
        category: String(r.rating_category ?? ""),
        grid: r.start_position,
        finish: r.finish_position,
        irating_delta: r.irating_delta,
        incidents: r.incidents,
        best_lap: r.best_lap_time,
      }))
      .filter((r) => (!carQ || r.car.toLowerCase().includes(carQ)) && (!trackQ || r.track.toLowerCase().includes(trackQ)));

    const slice = races.slice(0, limit);
    const totalDelta = races.reduce((acc, r) => acc + (Number(r.irating_delta) || 0), 0);
    return JSON.stringify({ total_matched: races.length, total_irating_delta: totalDelta, races: slice });
  }

  return JSON.stringify({ error: `Tool desconhecida: ${name}` });
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const model = modelFor("engineer");
  let totalIn = 0, totalCached = 0, totalOut = 0;

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

    let userImageTurns = 0;
    const keepImagesAt = new Set<number>();
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].role === "user" && normalized[i].images.length > 0 && userImageTurns < 2) {
        keepImagesAt.add(i);
        userImageTurns += 1;
      }
    }

    const catalog = await loadCatalog();
    const systemPrompt = [
      `Você é o Assistente IA do Racing Analytics para o piloto ${catalog.driverName}, conectado diretamente à base de dados completa no Supabase.`,
      "Diferente do chat do Engenheiro (que fica preso ao carro+pista selecionado no topo), aqui você pode responder perguntas abrangentes cruzando vários carros, pistas, setups (fixos vs. comerciais) e histórico de corridas.",
      "Sempre que o usuário perguntar sobre setups existentes, padrões entre fixo e comerciais, recomendações com base no que está salvo ou desempenho em corridas, USE as ferramentas `list_setups`, `inspect_or_compare_setups` e `query_race_history` antes de responder — nunca diga que não tem acesso à base de dados.",
      "Também suporta leitura de prints enviados pelo usuário (garagem do iRacing ou telemetria). Responda sempre em português do Brasil, de forma objetiva, organizada (tabelas/listas quando comparar) e sem inventar parâmetros que não estejam nos dados ou prints.",
    ].join("\n");

    const openAiMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...normalized.map((msg, idx) => {
        if (msg.role === "user" && keepImagesAt.has(idx)) {
          const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];
          if (msg.content) parts.push({ type: "text", text: msg.content });
          for (const url of msg.images) parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
          return { role: "user", content: parts };
        }
        return { role: msg.role, content: msg.content };
      }),
    ];

    let reply: string | null = null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          reasoning_effort: "none",
          messages: openAiMessages,
          tools: TOOLS,
          tool_choice: round < MAX_TOOL_ROUNDS ? "auto" : "none",
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        }),
      });

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          };
        }>;
        usage?: unknown;
        error?: { message?: string };
      };

      const usage = parseOpenAiUsage(data.usage);
      totalIn += usage.inputTokens ?? 0;
      totalCached += usage.cachedTokens ?? 0;
      totalOut += usage.outputTokens ?? 0;

      if (!response.ok) {
        await logAiUsage({ task: "engineer", model, ok: false, inputTokens: totalIn, cachedTokens: totalCached, outputTokens: totalOut, durationMs: Date.now() - t0, error: data.error?.message ?? `HTTP ${response.status}` });
        return NextResponse.json({ status: "error", message: data.error?.message ?? "Erro ao consultar o assistente de IA." }, { status: 502 });
      }

      const msg = data.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls ?? [];
      if (toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
        openAiMessages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: toolCalls });
        const results = await Promise.all(
          toolCalls.map(async (tc) => ({
            role: "tool",
            tool_call_id: tc.id,
            content: await runTool(tc.function.name, tc.function.arguments, catalog),
          }))
        );
        openAiMessages.push(...results);
        continue;
      }

      reply = msg?.content?.trim() ?? null;
      break;
    }

    if (!reply) {
      await logAiUsage({ task: "engineer", model, ok: false, inputTokens: totalIn, cachedTokens: totalCached, outputTokens: totalOut, durationMs: Date.now() - t0, error: "empty_reply" });
      return NextResponse.json({ status: "error", message: "O assistente não retornou resposta." }, { status: 502 });
    }

    await logAiUsage({ task: "engineer", model, ok: true, inputTokens: totalIn, cachedTokens: totalCached, outputTokens: totalOut, durationMs: Date.now() - t0 });
    return NextResponse.json({ status: "ok", reply });
  } catch (error) {
    await logAiUsage({ task: "engineer", model, ok: false, inputTokens: totalIn, cachedTokens: totalCached, outputTokens: totalOut, durationMs: Date.now() - t0, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ status: "error", message: "Não foi possível consultar o assistente agora." }, { status: 500 });
  }
}
