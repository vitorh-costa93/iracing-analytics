import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { comparativeSummary, diffSetups, type DecodedRow } from "@/lib/setup-diff";
import { buildSystemPrompt } from "@/lib/engineer-prompt";
import { indexRows, latestProposal, parseProposalBlock, resolveProposal, splitEngineerText, type ResolvedProposal } from "@/lib/engineer-proposal";
import { setupDisplayName } from "@/lib/setup-names";

export const maxDuration = 60; // Vercel Hobby ceiling -- a streamed gpt-4o reply routinely takes 15-40s
export const dynamic = "force-dynamic";

export type StoredMessage = {
  id: string; role: "user" | "assistant"; content: string; createdAt: string;
  /** Turno do piloto: setup ativo, se rodava a proposta anterior e setups citados com "/". */
  setupId?: string; setupName?: string; onProposal?: boolean; mentions?: Array<{ id: string; name: string }>;
  /** Turno do engenheiro: proposta estruturada já resolvida contra o setup (lib/engineer-proposal.ts). */
  proposal?: ResolvedProposal;
};

// Copied from app/api/setup/inventory/route.ts's own context() -- this codebase's established
// convention is one small inline copy per route, not a shared lib helper (no existing route shares
// this query via lib/ either).
async function context() {
  const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
  if (driverError || !driver) throw new Error("Piloto não encontrado");
  const { data: current, error: seasonError } = await supabaseAdmin
    .from("v_season_calendar")
    .select("season_id, season_name, season_start")
    .order("season_start", { ascending: false })
    .limit(1)
    .single();
  if (seasonError || !current) throw new Error("Season atual não encontrada");
  return { driverId: driver.id as string, seasonId: String(current.season_id) };
}

function parseCarTrack(url: string): { carId: number; trackId: number } {
  const { searchParams } = new URL(url);
  const carIdParam = searchParams.get("carId");
  const trackIdParam = searchParams.get("trackId");
  const carId = Number(carIdParam);
  const trackId = Number(trackIdParam);
  if (!carIdParam || !trackIdParam || !Number.isInteger(carId) || !Number.isInteger(trackId)) throw new Error("carId e trackId são obrigatórios");
  return { carId, trackId };
}

export async function GET(request: NextRequest) {
  try {
    const { carId, trackId } = parseCarTrack(request.url);
    const { driverId, seasonId } = await context();
    const { data, error } = await supabaseAdmin
      .from("engineer_conversations")
      .select("messages")
      .eq("driver_id", driverId).eq("season_id", seasonId).eq("car_id", carId).eq("track_id", trackId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ status: "ok", messages: (data?.messages as StoredMessage[] | undefined) ?? [] });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

const OPENAI_MODEL = "gpt-4o";
const MAX_HISTORY_MESSAGES = 20; // mirrors dashboard-psi/api/post-content.js's own truncation
const MAX_MESSAGE_LENGTH = 4000; // mirrors dashboard-psi/api/post-content.js's own per-message truncation length
const MAX_COMPLETION_TOKENS = 1000; // CLAUDE.md rule 7 cost guard-rail -- caps spend on a single reply
const MAX_MENTIONS = 2; // setups citados com "/" que entram no prompt (cada um soma uma tabela de diferenças)

// Mirrors dashboard-psi/api/_openai-retry.js's fetchComRetentativa: retries on network error/timeout
// or a 5xx/429 response (transient failures), never on other 4xx (our own request's problem, retrying
// won't change the outcome). Kept route-local since no other route in this codebase shares an OpenAI
// call yet -- if a second one appears, promote this to lib/.
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { attempts = 2, baseDelayMs = 500, timeoutMs = 55000 }: { attempts?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      const canRetry = !response.ok && (response.status >= 500 || response.status === 429);
      if (!canRetry || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timer);
      if (attempt === attempts) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
  }
  throw lastError;
}

type PostBody = {
  carId?: number; trackId?: number; carName?: string; trackName?: string;
  /** Setup ativo: a conversa é sempre sobre ele. */
  setupId?: string;
  /** O piloto está rodando a última proposta do engenheiro, aplicada à mão sobre o setup ativo. */
  useProposal?: boolean;
  /** Setups citados com "/" na mensagem (no máximo MAX_MENTIONS entram no prompt). */
  mentionIds?: string[];
  message?: string; regenerate?: boolean;
};

type SetupRecord = { id: string; filename: string; rows: DecodedRow[] };

async function loadSetups(driverId: string, carId: number, trackId: number, ids: string[]): Promise<Map<string, SetupRecord>> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))];
  if (!unique.length) return new Map();
  const { data } = await supabaseAdmin.from("setup_files").select("id,filename,decoded_params").eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).in("id", unique);
  return new Map((data ?? []).map((row) => [String(row.id), { id: String(row.id), filename: String(row.filename), rows: Array.isArray(row.decoded_params) ? (row.decoded_params as DecodedRow[]) : [] }]));
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  try {
    const body = (await request.json()) as PostBody;
    if (!Number.isInteger(body.carId) || !Number.isInteger(body.trackId)) throw new Error("carId e trackId são obrigatórios");
    if (!body.message?.trim() && !body.regenerate) throw new Error("Escreva uma mensagem ou peça para regenerar");
    if (body.message && body.message.length > MAX_MESSAGE_LENGTH) throw new Error(`Mensagem muito longa (máximo ${MAX_MESSAGE_LENGTH} caracteres)`);
    const apiKey = process.env.OPENAI_KEY;
    if (!apiKey) throw new Error("OPENAI_KEY não configurada");

    const { driverId, seasonId } = await context();
    const carId = body.carId as number, trackId = body.trackId as number;

    const { data: existingRow } = await supabaseAdmin
      .from("engineer_conversations")
      .select("messages")
      .eq("driver_id", driverId).eq("season_id", seasonId).eq("car_id", carId).eq("track_id", trackId)
      .maybeSingle();
    let messages: StoredMessage[] = (existingRow?.messages as StoredMessage[] | undefined) ?? [];

    // Regenerar reaproveita o setup e as citações gravados no turno do piloto (sobrevive a recarregar a página).
    let grounding: { setupId?: string; useProposal: boolean; mentionIds: string[] };
    if (body.regenerate) {
      if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") throw new Error("Nada para regenerar ainda");
      messages = messages.slice(0, -1); // drop the last assistant turn; last remaining message is the user turn to re-answer
      const lastUser = messages[messages.length - 1];
      grounding = { setupId: lastUser?.setupId ?? body.setupId, useProposal: Boolean(lastUser?.onProposal), mentionIds: (lastUser?.mentions ?? []).map((item) => item.id) };
    } else {
      grounding = { setupId: body.setupId, useProposal: Boolean(body.useProposal), mentionIds: Array.isArray(body.mentionIds) ? body.mentionIds.slice(0, MAX_MENTIONS) : [] };
    }

    const setups = await loadSetups(driverId, carId, trackId, [grounding.setupId ?? "", ...grounding.mentionIds]);
    const active = grounding.setupId ? setups.get(grounding.setupId) ?? null : null;
    const activeName = active ? setupDisplayName(active.filename) : "";
    const activeRows = active ? indexRows(active.rows) : [];
    const previousProposal = active && grounding.useProposal ? latestProposal(messages) : null;
    const appliedProposal = previousProposal && previousProposal.baseSetupId === active?.id ? previousProposal : null;
    const mentions = grounding.mentionIds
      .map((id) => setups.get(id))
      .filter((item): item is SetupRecord => item !== undefined && item.id !== active?.id);
    const cited = active && active.rows.length
      ? mentions.filter((item) => item.rows.length).map((item) => {
        const name = setupDisplayName(item.filename);
        const changes = diffSetups(active.rows, item.rows);
        return { name, summary: comparativeSummary(changes, activeName, name), changes };
      })
      : [];

    if (!body.regenerate) {
      const userTurn: StoredMessage = { id: crypto.randomUUID(), role: "user", content: body.message!.trim(), createdAt: new Date().toISOString() };
      if (active) { userTurn.setupId = active.id; userTurn.setupName = activeName; }
      if (appliedProposal) userTurn.onProposal = true;
      if (mentions.length) userTurn.mentions = mentions.map((item) => ({ id: item.id, name: setupDisplayName(item.filename) }));
      messages = [...messages, userTurn];
    }

    const systemPrompt = buildSystemPrompt({
      carName: body.carName ?? "este carro", trackName: body.trackName ?? "esta pista",
      activeSetup: active && activeRows.length ? { name: activeName, rows: activeRows } : null,
      appliedProposal,
      cited,
    });
    const openAiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ role: message.role, content: message.content })),
    ];

    const upstream = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: OPENAI_MODEL, stream: true, messages: openAiMessages, max_tokens: MAX_COMPLETION_TOKENS }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`Erro da OpenAI (${upstream.status}): ${detail.slice(0, 500)}`);
      throw new Error(`Erro da OpenAI (status ${upstream.status}). Tente novamente.`);
    }

    let assembled = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamFailed = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const event of events) {
              const line = event.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta: string | undefined = json.choices?.[0]?.delta?.content;
                if (delta) { assembled += delta; controller.enqueue(encoder.encode(delta)); }
              } catch {
                // Malformed/partial SSE chunk -- skip it, the next read() call will complete it.
              }
            }
          }
        } catch {
          // reader.read() itself threw mid-transfer (dropped connection, etc.) -- the client would
          // otherwise see the stream just end, indistinguishable from a complete answer. Surface it
          // explicitly instead of silently truncating; the partial answer is still never persisted
          // (streamFailed guards the block below), per the spec's "don't save an incomplete stream
          // as a complete assistant turn" rule.
          streamFailed = true;
          try {
            controller.enqueue(encoder.encode("\n\n[Erro: conexão com a IA foi interrompida -- tente novamente ou peça para regenerar]"));
          } catch {
            // controller may already be torn down if the client disconnected -- nothing to enqueue into.
          }
        }

        // Persistence MUST happen before controller.close() below: on Vercel's serverless runtime,
        // nothing guarantees the function invocation stays alive once the HTTP response is closed, so
        // an awaited write placed after close() (as this used to be) can silently never execute in
        // production, even though `next dev` (which keeps the whole process alive regardless) hides
        // the bug locally. Wrapped in its own try/catch so a Supabase failure here can't skip the
        // controller.close() call below, or crash the whole handler.
        if (!streamFailed && assembled.trim()) {
          try {
            // O bloco <proposta> sai do texto guardado e vira a proposta resolvida (valores A → B).
            // Bloco ausente ou inválido = turno sem proposta; nunca impede de salvar a resposta.
            const { visible, block } = splitEngineerText(assembled);
            let proposal: ResolvedProposal | null = null;
            try {
              proposal = active ? resolveProposal(parseProposalBlock(block), activeRows, { id: active.id, name: activeName }, appliedProposal) : null;
            } catch (proposalError) {
              console.error("Proposta do engenheiro ignorada:", proposalError);
            }
            const assistantTurn: StoredMessage = { id: crypto.randomUUID(), role: "assistant", content: visible || assembled, createdAt: new Date().toISOString() };
            if (proposal) assistantTurn.proposal = proposal;
            const finalMessages = [...messages, assistantTurn];
            await supabaseAdmin.from("engineer_conversations").upsert(
              { driver_id: driverId, season_id: seasonId, car_id: carId, track_id: trackId, messages: finalMessages, updated_at: new Date().toISOString() },
              { onConflict: "driver_id,season_id,car_id,track_id" },
            );
          } catch (persistError) {
            console.error("Falha ao persistir engineer_conversations:", persistError);
          }
        }

        controller.close();
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { carId, trackId } = parseCarTrack(request.url);
    const { driverId, seasonId } = await context();
    const { error } = await supabaseAdmin
      .from("engineer_conversations")
      .delete()
      .eq("driver_id", driverId).eq("season_id", seasonId).eq("car_id", carId).eq("track_id", trackId);
    if (error) throw error;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
