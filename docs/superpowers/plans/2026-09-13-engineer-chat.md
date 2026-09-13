# Engenheiro de Pista como Chat com IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Setup Lab's rule-based "Engenheiro" (regex pattern matching, no memory, no persistence) with a real multi-turn OpenAI-backed chat, one continuous thread per (car, track, season), saved to Supabase and streamed to the browser.

**Architecture:** A new `engineer_conversations` table (one row per driver+season+car+track, `messages` JSONB array) backs a new `app/api/setup/engineer/chat/route.ts` (GET loads the thread, POST sends a message or regenerates the last answer via a direct streaming `fetch` to OpenAI's Chat Completions API, DELETE clears the thread). The car-specific ARB/differential/spring/brake-bias knowledge already encoded in the old rule engine becomes static grounding prose in a new `lib/engineer-prompt.ts`, fed to the LLM alongside the driver's own decoded setup parameters (and, when two setups are mentioned via `/setup`, the existing `diffSetups`/`comparativeSummary` structural diff — unchanged). `components/SetupLab.tsx`'s "Engenheiro" tab is reworked into a real chat UI: streaming text, Markdown rendering, copy/regenerate, "Nova conversa".

**Tech Stack:** Next.js 15 Route Handlers (Node runtime, `ReadableStream`), Supabase (Postgres + `supabaseAdmin` service role), OpenAI Chat Completions API via raw `fetch` with `stream: true` (no `openai` SDK dependency — mirrors `dashboard-psi/api/_openai-retry.js`'s own pattern), `react-markdown` (new dependency) for rendering assistant replies.

**Spec:** `docs/superpowers/specs/2026-09-13-engineer-chat-design.md`

## Global Constraints

- `(driver_id, season_id, car_id, track_id)` is the exact scoping key for a thread — same convention `setup_files` already uses (`unique (driver_id, season_id, car_id, track_id, filename)`).
- Category (GT3/GTP/Formula) is **not** a stored column anywhere in this plan — it's derived from `car_id` only if ever needed, never a separate key.
- No raw telemetry (`laps`, corner detection, etc.) is fetched for the LLM's context in this plan — only `setup_files.decoded_params` and the existing `diffSetups` output.
- Conversation history sent to OpenAI is capped at the last 20 stored messages (mirrors `dashboard-psi/api/post-content.js`'s own truncation) to bound token cost as a thread grows.
- The `.sto` file is never rewritten — every response's grounding prompt says so explicitly, the same disclosure the old rule engine always included.
- `OPENAI_KEY` is a new environment variable this plan does NOT set on Vercel — that is an explicit stop-and-ask step for the repo owner, called out at the end of this plan, not something a task does automatically.
- Every recommendation direction is phrased as an explicit "aumente"/"diminua" the on-screen value (never just "mais rígido"/"mais macio") and never invents an exact continuous target — both are existing non-negotiable framing rules from the old engine, carried into the new system prompt verbatim.

---

### Task 1: Database migration — `engineer_conversations` table

**Files:**
- Create: `supabase/migrations/20260913120000_engineer_conversations.sql`

**Interfaces:**
- Produces: table `public.engineer_conversations(id, driver_id, season_id, car_id, track_id, messages jsonb, created_at, updated_at)`, unique on `(driver_id, season_id, car_id, track_id)` — every later task's Supabase queries assume this exact shape and constraint name is enforced by Postgres's own auto-generated constraint (no need to name it explicitly, `upsert(...).onConflict("driver_id,season_id,car_id,track_id")` addresses it by column list, matching how `setup_files` upserts already work elsewhere in this codebase).

- [ ] **Step 1: Write the migration**

```sql
-- Persisted multi-turn conversation with the OpenAI-backed setup engineer, one row per
-- driver+season+car+track (same scoping convention setup_files already uses). A single JSONB
-- array, not a child table -- this is a single-user app, thread sizes are small, and "read/write
-- the whole conversation" is the only access pattern that ever happens.
create table if not exists public.engineer_conversations (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  season_id text not null,
  car_id bigint not null references public.cars(id),
  track_id bigint not null references public.tracks(id),
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, season_id, car_id, track_id)
);

create index if not exists idx_engineer_conversations_context
  on public.engineer_conversations (driver_id, season_id, car_id, track_id);

alter table public.engineer_conversations enable row level security;

comment on table public.engineer_conversations is
  'Private single-user chat history with the OpenAI-backed setup engineer. Access is server-side only through the service role.';
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db push --linked` (or the project's own established migration-apply command — check `docs/DATA_ARCHITECTURE.md`/recent migration commits for the exact invocation this repo uses if `db push` isn't it).

Verify with a read-only query:
```bash
npx supabase db query --linked "select table_name from information_schema.tables where table_name = 'engineer_conversations';"
```
Expected: one row, `engineer_conversations`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260913120000_engineer_conversations.sql
git commit -m "feat: engineer_conversations table for the OpenAI-backed setup chat"
```

---

### Task 2: `lib/engineer-prompt.ts` — system prompt builder

**Files:**
- Create: `lib/engineer-prompt.ts`
- Test: `lib/engineer-prompt.test.ts`

**Interfaces:**
- Consumes: `DecodedRow`, `ParsedChange` types from `lib/setup-diff.ts` (already exist, unchanged).
- Produces: `buildSystemPrompt(input: EngineerPromptInput): string`, `type EngineerPromptInput = { carName: string; trackName: string; primarySetup: { filename: string; rows: DecodedRow[] } | null; diff: { baseLabel: string; comparisonLabel: string; summary: string; changes: ParsedChange[] } | null }` — Task 4's POST handler builds this input and passes it in; the returned string is the `system` message content sent to OpenAI.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/engineer-prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./engineer-prompt";

describe("buildSystemPrompt", () => {
  it("always includes the car/track header and the non-negotiable framing rules", () => {
    const prompt = buildSystemPrompt({ carName: "McLaren 720S GT3 EVO", trackName: "Spa-Francorchamps", primarySetup: null, diff: null });
    expect(prompt).toContain("McLaren 720S GT3 EVO");
    expect(prompt).toContain("Spa-Francorchamps");
    expect(prompt).toContain("aumente");
    expect(prompt).toContain("diminua");
    expect(prompt).toContain(".sto");
  });

  it("includes the primary setup's decoded parameters as a table when provided", () => {
    const prompt = buildSystemPrompt({
      carName: "McLaren 720S GT3 EVO",
      trackName: "Spa-Francorchamps",
      primarySetup: { filename: "race-setup.sto", rows: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", metric_value: "180 N/mm" }] },
      diff: null,
    });
    expect(prompt).toContain("race-setup.sto");
    expect(prompt).toContain("Spring Rate");
    expect(prompt).toContain("180 N/mm");
  });

  it("includes the structural diff narrative and changed parameters when two setups are compared, instead of the single-setup table", () => {
    const prompt = buildSystemPrompt({
      carName: "McLaren 720S GT3 EVO",
      trackName: "Spa-Francorchamps",
      primarySetup: { filename: "ignored-when-diff-present.sto", rows: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", metric_value: "180 N/mm" }] },
      diff: {
        baseLabel: "setup-a.sto",
        comparisonLabel: "setup-b.sto",
        summary: "O setup B é mais macio na traseira.",
        changes: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", before: "180 N/mm", after: "160 N/mm", explanation: "Mais aderência mecânica.", category: "spring", actionable: true, settable: true, numericDelta: -20 }],
      },
    });
    expect(prompt).toContain("setup-a.sto");
    expect(prompt).toContain("setup-b.sto");
    expect(prompt).toContain("O setup B é mais macio na traseira.");
    expect(prompt).toContain("180 N/mm");
    expect(prompt).toContain("160 N/mm");
    expect(prompt).not.toContain("ignored-when-diff-present.sto");
  });

  it("says explicitly when there is no decoded setup and no diff to ground answers in", () => {
    const prompt = buildSystemPrompt({ carName: "McLaren 720S GT3 EVO", trackName: "Spa-Francorchamps", primarySetup: null, diff: null });
    expect(prompt.toLowerCase()).toContain("não há setup decodificado");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engineer-prompt.test.ts`
Expected: FAIL — `lib/engineer-prompt.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/engineer-prompt.ts
import type { DecodedRow, ParsedChange } from "./setup-diff";

export type EngineerPromptInput = {
  carName: string;
  trackName: string;
  primarySetup: { filename: string; rows: DecodedRow[] } | null;
  diff: { baseLabel: string; comparisonLabel: string; summary: string; changes: ParsedChange[] } | null;
};

// Ported from app/api/setup/engineer/route.ts's own arbTarget/differentialTarget/springTarget doc
// comments (themselves sourced from the official SF23/GT3/GTP manuals) -- static grounding prose
// instead of executable branches, so the LLM reasons over it directly instead of a fixed decision
// tree. The three architectures' terminology differs enough (see each paragraph) that naming them
// explicitly matters more than a generic "stiffer/softer" gloss would.
const DOMAIN_KNOWLEDGE = `Conhecimento técnico de referência (baseado nos manuais oficiais destes carros -- use como base, não invente números fora dele):

BARRA ESTABILIZADORA (ARB): no Super Formula SF23 e nos GT3, é "ARB Diameter"/"ARB Size" (mm) -- diâmetro maior é sempre mais rígido, só existem alguns tamanhos fixos (nunca um intervalo contínuo). Nos GTP (Acura ARX-06, BMW M Hybrid V8, Porsche 963, Cadillac V-Series.R -- confirmado idêntico nos quatro manuais oficiais, é convenção da classe) é "ARB Blades" numerado -- número maior é mais rígido. O Ferrari 499P (GTP, sem manual oficial publicado) segue essa mesma convenção por analogia de classe, não por confirmação específica.

DIFERENCIAL: três arquiteturas diferentes.
- SF23: "Coast Angle" (frenagem/desaceleração) e "Drive Angle" (aceleração) são independentes. ÂNGULO MAIOR = MENOS força de bloqueio (contra-intuitivo) -- ângulo menor é o que aumenta o bloqueio.
- GT3: um único "Diff Preload" (ft-lbs). Aumentar preload sempre soma dois efeitos ao mesmo tempo: mais subesterço fora do acelerador (entrada mais estável) E mais sobresterço de "snap" no acelerador -- é um dial só, não dois independentes.
- GTP: "Ramp Angles" funciona como o coast/drive angle do SF23 (ângulo menor = mais bloqueio) mas afeta frenagem E aceleração JUNTOS, não separadamente. Também tem "Preload" (igual ao GT3: mais = mais bloqueio, mesmo trade-off dos dois lados) e "Clutch Friction Plates" (mais placas = mais bloqueio em toda a volta, sempre, é um multiplicador geral).

MOLA TRASEIRA: no SF23 e GT3 é "Spring Rate" por roda (Left Rear / Right Rear, ajustável independente). Nos GTP não existe mola por roda -- é uma "Heave Spring" central, desacoplada do rolamento por design. Amolecer a heave spring reduz downforce/eficiência em curva rápida porque a altura traseira cai abaixo do ideal aerodinâmico -- isso é um trade-off explícito do manual, não um efeito colateral raro.

BRAKE BIAS: mais bias dianteiro (número maior) reduz a chance de a traseira rotacionar na frenagem, mas pode empurrar em direção ao subesterço na entrada; menos bias dianteiro faz o oposto.

REGRAS OBRIGATÓRIAS PARA TODA RESPOSTA:
1. Diga sempre explicitamente se o piloto deve AUMENTAR ou DIMINUIR o valor que aparece na tela do jogo -- nunca s6 "deixe mais rígido/macio", porque isso não diz qual direção de seta/dropdown clicar.
2. Nunca invente um valor-alvo contínuo exato (N/mm, mm, graus, %) que o carro talvez não aceite -- esses parâmetros só aceitam alguns degraus fixos do catálogo do carro, que não temos mapeados. Aponte a direção e deixe o piloto usar a seta/dropdown do próprio jogo para o próximo valor disponível. Cliques de amortecedor (damper clicks) são a única exceção -- ±1 clique sempre é um valor válido.
3. Sempre deixe claro que o arquivo .sto original NÃO é regravado por este app -- qualquer mudança sugerida precisa ser aplicada manualmente no menu do carro dentro do iRacing.
4. Se o piloto descrever um sintoma sem dizer a fase da curva (entrada/meio/saída) ou o eixo (dianteira/traseira), pergunte antes de sugerir uma mudança -- uma mudança de setup pode corrigir um trecho e piorar outro.`;

function formatDecodedRows(rows: DecodedRow[]): string {
  if (!rows.length) return "";
  return rows
    .filter((row) => row.label)
    .map((row) => `| ${row.tab ?? "Setup"} | ${row.section ?? "Geral"} | ${row.label} | ${row.metric_value ?? "—"} |`)
    .join("\n");
}

function formatDiffChanges(changes: ParsedChange[]): string {
  return changes
    .filter((change) => change.actionable)
    .map((change) => `| ${change.tab} | ${change.section} | ${change.label} | ${change.before} | ${change.after} |`)
    .join("\n");
}

export function buildSystemPrompt(input: EngineerPromptInput): string {
  const header = `Você é o engenheiro de pista pessoal do piloto para o ${input.carName} em ${input.trackName}. Converse naturalmente, mas toda recomendação técnica deve se basear no conhecimento abaixo e nos dados reais do setup do piloto.`;

  let groundingSection: string;
  if (input.diff) {
    const table = formatDiffChanges(input.diff.changes);
    groundingSection = `O piloto está comparando dois setups: "${input.diff.baseLabel}" e "${input.diff.comparisonLabel}".\n\nResumo comparativo: ${input.diff.summary}\n\nDiferenças com efeito prático conhecido:\n| Aba | Seção | Parâmetro | ${input.diff.baseLabel} | ${input.diff.comparisonLabel} |\n|---|---|---|---|---|\n${table || "(nenhuma diferença com efeito prático mapeado)"}\n\nUse essa comparação real para discutir com o piloto para qual lado pender em cada trecho -- não invente um "meio-termo" calculado, o valor exato precisa ser escolhido por ele no menu do carro.`;
  } else if (input.primarySetup && input.primarySetup.rows.length) {
    const table = formatDecodedRows(input.primarySetup.rows);
    groundingSection = `Setup ativo do piloto: "${input.primarySetup.filename}".\n\nParâmetros decodificados:\n| Aba | Seção | Parâmetro | Valor atual |\n|---|---|---|---|\n${table}\n\nUse esses valores reais ao recomendar uma direção (ex.: cite o valor atual do parâmetro relevante).`;
  } else {
    groundingSection = "Não há setup decodificado disponível para este carro/pista ainda -- suas recomendações precisam ser genéricas (direção do ajuste, não valor atual), e você deve dizer isso ao piloto.";
  }

  return `${header}\n\n${DOMAIN_KNOWLEDGE}\n\n${groundingSection}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engineer-prompt.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add lib/engineer-prompt.ts lib/engineer-prompt.test.ts
git commit -m "feat: engineer system-prompt builder, porting the old rule engine's domain knowledge"
```

---

### Task 3: Chat route — GET (load thread) and DELETE (reset thread)

**Files:**
- Create: `app/api/setup/engineer/chat/route.ts`
- Test: `app/api/setup/engineer/chat/route.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase-admin` (existing).
- Produces: `GET` handler returning `{ status: "ok", messages: StoredMessage[] }`; `DELETE` handler returning `{ status: "ok" }`; a shared `context()` helper (driver + current season, copied from `app/api/setup/inventory/route.ts`'s own, since this codebase's established convention is one small inline copy per route rather than a shared lib — see that file for the exact query) and a shared `type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string }` — Task 4 (POST, same file) and `components/SetupLab.tsx` (Task 5) both need this exact shape.

- [ ] **Step 1: Write the failing tests**

```typescript
// app/api/setup/engineer/chat/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = { driver: { id: "driver-1" }, season: { season_id: "2026s3", season_name: "2026 Season 3", season_start: "2026-07-01T00:00:00Z" }, row: null as { messages: unknown[] } | null };

vi.mock("@/lib/supabase-admin", () => {
  const supabaseAdmin = {
    from(table: string) {
      if (table === "drivers") return { select: () => ({ order: () => ({ limit: () => ({ single: async () => ({ data: state.driver, error: null }) }) }) }) };
      if (table === "v_season_calendar") return { select: () => ({ order: () => ({ limit: () => ({ single: async () => ({ data: state.season, error: null }) }) }) }) };
      if (table === "engineer_conversations") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }) }) }) }),
          delete: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabaseAdmin };
});

import { DELETE, GET } from "./route";

function req(url: string) { return new Request(url) as unknown as Parameters<typeof GET>[0]; }

describe("GET /api/setup/engineer/chat", () => {
  beforeEach(() => { state.row = null; });

  it("returns an empty message list when no thread exists yet", async () => {
    const response = await GET(req("http://test/api/setup/engineer/chat?carId=5&trackId=9"));
    const body = await response.json();
    expect(body).toEqual({ status: "ok", messages: [] });
  });

  it("returns the stored messages when a thread exists", async () => {
    state.row = { messages: [{ id: "1", role: "user", content: "oi", createdAt: "2026-09-13T00:00:00Z" }] };
    const response = await GET(req("http://test/api/setup/engineer/chat?carId=5&trackId=9"));
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("oi");
  });

  it("rejects a missing carId/trackId", async () => {
    const response = await GET(req("http://test/api/setup/engineer/chat"));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/setup/engineer/chat", () => {
  it("clears the thread and returns ok", async () => {
    const response = await DELETE(req("http://test/api/setup/engineer/chat?carId=5&trackId=9"));
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/setup/engineer/chat/route.test.ts`
Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Write the implementation** (GET + DELETE only — POST is Task 4, in the same file)

```typescript
// app/api/setup/engineer/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };

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
  const carId = Number(searchParams.get("carId"));
  const trackId = Number(searchParams.get("trackId"));
  if (!Number.isInteger(carId) || !Number.isInteger(trackId)) throw new Error("carId e trackId são obrigatórios");
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/setup/engineer/chat/route.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add app/api/setup/engineer/chat/route.ts app/api/setup/engineer/chat/route.test.ts
git commit -m "feat: GET/DELETE handlers for the engineer chat thread"
```

---

### Task 4: Chat route — POST (send message / regenerate, streamed from OpenAI)

**Files:**
- Modify: `app/api/setup/engineer/chat/route.ts` (add `POST`, alongside Task 3's `GET`/`DELETE`)

**Interfaces:**
- Consumes: `StoredMessage`, `context()` from Task 3 (same file); `buildSystemPrompt` from `lib/engineer-prompt.ts` (Task 2); `diffSetups`, `comparativeSummary`, `DecodedRow` from `lib/setup-diff.ts` (existing, unchanged).
- Produces: `POST` handler. Request body: `{ carId: number; trackId: number; carName: string; trackName: string; setupId?: string; blendWithSetupId?: string; message?: string; regenerate?: boolean }` (one of `message` or `regenerate: true` is required). Response: a streamed `text/plain` body of the assistant's reply text, persisted to `engineer_conversations` once the stream completes.

**Note on this task's own testing:** per this plan's spec, the OpenAI network call itself is not unit-tested (network I/O to a third-party API, same practical boundary already drawn around Garage61/iRStats calls elsewhere in this app). This task is verified by `npm run build` succeeding and a manual smoke test (Step 5 below) against the real OpenAI API using a real `OPENAI_KEY` in your own local `.env.local` — not by an automated test file.

- [ ] **Step 1: Add the POST handler**

```typescript
// Add to app/api/setup/engineer/chat/route.ts, alongside the existing imports:
import { comparativeSummary, diffSetups, type DecodedRow } from "@/lib/setup-diff";
import { buildSystemPrompt } from "@/lib/engineer-prompt";

const OPENAI_MODEL = "gpt-4o";
const MAX_HISTORY_MESSAGES = 20; // mirrors dashboard-psi/api/post-content.js's own truncation

type PostBody = {
  carId?: number; trackId?: number; carName?: string; trackName?: string;
  setupId?: string; blendWithSetupId?: string; message?: string; regenerate?: boolean;
};

async function loadSetupRows(driverId: string, carId: number, trackId: number, setupId: string): Promise<{ filename: string; rows: DecodedRow[] } | null> {
  const { data } = await supabaseAdmin.from("setup_files").select("filename,decoded_params").eq("id", setupId).eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).maybeSingle();
  if (!data) return null;
  return { filename: data.filename, rows: Array.isArray(data.decoded_params) ? (data.decoded_params as DecodedRow[]) : [] };
}

async function loadDiff(driverId: string, carId: number, trackId: number, setupIdA: string, setupIdB: string) {
  const { data } = await supabaseAdmin.from("setup_files").select("id,filename,decoded_params").eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).in("id", [setupIdA, setupIdB]);
  if (!data || data.length !== 2) return null;
  const a = data.find((row) => row.id === setupIdA)!, b = data.find((row) => row.id === setupIdB)!;
  const rowsA: DecodedRow[] = Array.isArray(a.decoded_params) ? (a.decoded_params as DecodedRow[]) : [];
  const rowsB: DecodedRow[] = Array.isArray(b.decoded_params) ? (b.decoded_params as DecodedRow[]) : [];
  if (!rowsA.length || !rowsB.length) return null;
  const changes = diffSetups(rowsA, rowsB);
  return { baseLabel: a.filename, comparisonLabel: b.filename, summary: comparativeSummary(changes, a.filename, b.filename), changes };
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  try {
    const body = (await request.json()) as PostBody;
    if (!Number.isInteger(body.carId) || !Number.isInteger(body.trackId)) throw new Error("carId e trackId são obrigatórios");
    if (!body.message?.trim() && !body.regenerate) throw new Error("Escreva uma mensagem ou peça para regenerar");
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

    if (body.regenerate) {
      if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") throw new Error("Nada para regenerar ainda");
      messages = messages.slice(0, -1); // drop the last assistant turn; last remaining message is the user turn to re-answer
    } else {
      messages = [...messages, { id: crypto.randomUUID(), role: "user", content: body.message!.trim(), createdAt: new Date().toISOString() }];
    }

    const diff = body.blendWithSetupId && body.setupId && body.blendWithSetupId !== body.setupId
      ? await loadDiff(driverId, carId, trackId, body.setupId, body.blendWithSetupId)
      : null;
    const primarySetup = !diff && body.setupId ? await loadSetupRows(driverId, carId, trackId, body.setupId) : null;

    const systemPrompt = buildSystemPrompt({
      carName: body.carName ?? "este carro", trackName: body.trackName ?? "esta pista",
      primarySetup, diff: diff ? { baseLabel: diff.baseLabel, comparisonLabel: diff.comparisonLabel, summary: diff.summary, changes: diff.changes } : null,
    });
    const openAiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ role: message.role, content: message.content })),
    ];

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: OPENAI_MODEL, stream: true, messages: openAiMessages }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`Erro da OpenAI (${upstream.status}): ${detail.slice(0, 300)}`);
    }

    let assembled = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
        } finally {
          controller.close();
        }

        if (assembled.trim()) {
          const finalMessages = [...messages, { id: crypto.randomUUID(), role: "assistant" as const, content: assembled, createdAt: new Date().toISOString() }];
          await supabaseAdmin.from("engineer_conversations").upsert(
            { driver_id: driverId, season_id: seasonId, car_id: carId, track_id: trackId, messages: finalMessages, updated_at: new Date().toISOString() },
            { onConflict: "driver_id,season_id,car_id,track_id" },
          );
        }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Verify the whole file builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the existing GET/DELETE tests to confirm no regression**

Run: `npx vitest run app/api/setup/engineer/chat/route.test.ts`
Expected: PASS (still 4 passed) — Task 3's tests don't exercise POST, so they're unaffected, but this confirms nothing in the shared file broke.

- [ ] **Step 4: Add `OPENAI_KEY` to your own local `.env.local`**

This is your own local key for manual testing only — do NOT commit it. Get a key from
`platform.openai.com/api-keys` (or reuse the account already used for `dashboard-psi`, as a
separate key).

```
OPENAI_KEY=sk-...
```

- [ ] **Step 5: Manual smoke test against the real OpenAI API**

```bash
npm run dev
```
In another terminal, with the dev server running and at least one context that has a
`driverId`/season/car/track already set up in your local Supabase (any context Setup Lab already
shows), send a real request:
```bash
curl -N -X POST http://localhost:3000/api/setup/engineer/chat \
  -H "Content-Type: application/json" \
  -d '{"carId": <a real carId>, "trackId": <a real trackId>, "carName": "Test Car", "trackName": "Test Track", "message": "O carro subestera na entrada da curva 1"}'
```
Expected: the terminal prints text incrementally (streaming, not all at once), in Portuguese,
discussing brake bias / front ARB per the domain knowledge in `lib/engineer-prompt.ts`. Then:
```bash
curl -s "http://localhost:3000/api/setup/engineer/chat?carId=<same carId>&trackId=<same trackId>"
```
Expected: `{"status":"ok","messages":[...]}` with exactly 2 messages (the user turn and the
assistant turn just streamed), proving persistence worked.

- [ ] **Step 6: Commit**

```bash
git add app/api/setup/engineer/chat/route.ts
git commit -m "feat: POST handler streaming OpenAI responses into the engineer chat thread"
```

---

### Task 5: `components/SetupLab.tsx` — real chat UI

**Files:**
- Modify: `components/SetupLab.tsx`
- Delete: `app/api/setup/engineer/route.ts` (fully superseded — its domain knowledge already ported to `lib/engineer-prompt.ts` in Task 2, its `blendSetups`/diff logic already reused via `lib/setup-diff.ts` directly in Task 4)
- Modify: `package.json` (add `react-markdown`)

**Interfaces:**
- Consumes: `GET`/`POST`/`DELETE` `/api/setup/engineer/chat` (Tasks 3-4), `StoredMessage` shape (mirror client-side, don't import a server route's type into a client component — redeclare the same shape locally).

- [ ] **Step 1: Add the dependency**

```bash
npm install react-markdown
```

- [ ] **Step 2: Delete the old rule-based route**

```bash
rm app/api/setup/engineer/route.ts
```

- [ ] **Step 3: Replace the `ConversationTurn`/`EngineerResult` types and engineer state in `SetupLab.tsx`**

Remove these two lines (no longer used — the new thread is a flat list of `{role, content}`, not `{role:"user"}|{role:"assistant", result}`):
```typescript
type EngineerRecommendation = { adjustment: string; direction: string; why: string; validate: string; parameter: { label: string; current: string } | null };
type EngineerResult = { summary: string; limitation: string; hasDecodedParameters: boolean; recommendations: EngineerRecommendation[] };
type ConversationTurn = { role: "user"; text: string } | { role: "assistant"; result: EngineerResult };
```
Replace with:
```typescript
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
```

Replace the `conversation`/`analyzing` state declarations:
```typescript
const [conversation, setConversation] = useState<ConversationTurn[]>([]);
```
with:
```typescript
const [conversation, setConversation] = useState<ChatMessage[]>([]);
const [streamingText, setStreamingText] = useState<string | null>(null); // in-progress assistant reply, null when not streaming
const [loadingThread, setLoadingThread] = useState(false);
```
(keep the existing `analyzing` state — it still gates the send button while a request is in flight, now covering "streaming in progress" too).

- [ ] **Step 4: Load the thread when the context changes, instead of resetting to `[]`**

Replace this line inside the existing `useEffect` keyed on `[context, selected?.uploads]`:
```typescript
setConversation([]);
```
with:
```typescript
if (selected) {
  setLoadingThread(true);
  fetch(`/api/setup/engineer/chat?carId=${selected.car.id}&trackId=${selected.track.id}`, { cache: "no-store" })
    .then((response) => response.json())
    .then((data) => setConversation(data.status === "ok" ? data.messages : []))
    .finally(() => setLoadingThread(false));
} else {
  setConversation([]);
}
```

- [ ] **Step 5: Replace `runEngineer` with a streaming send + a regenerate + a reset function**

Remove the entire existing `runEngineer` function and replace with:

```typescript
async function sendToEngineer(userMessage: string | null) {
  if (!selected) return;
  const primarySetupId = mentionedSetupIds[0] ?? activeSetupId;
  setAnalyzing(true); setMessage(null);
  if (userMessage) {
    setConversation((current) => [...current, { id: crypto.randomUUID(), role: "user", content: userMessage, createdAt: new Date().toISOString() }]);
    setFeedback("");
  }
  setStreamingText("");
  try {
    const body: Record<string, unknown> = {
      carId: selected.car.id, trackId: selected.track.id, carName: selected.car.name, trackName: selected.track.name,
      setupId: primarySetupId || undefined,
    };
    if (mentionedSetupIds.length >= 2) body.blendWithSetupId = mentionedSetupIds[1];
    if (userMessage) body.message = userMessage; else body.regenerate = true;

    const response = await fetch("/api/setup/engineer/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message ?? "Erro na análise");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assembled = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assembled += decoder.decode(value, { stream: true });
      setStreamingText(assembled);
    }
    setConversation((current) => userMessage
      ? [...current, { id: crypto.randomUUID(), role: "assistant", content: assembled, createdAt: new Date().toISOString() }]
      : [...current.slice(0, -1), { id: crypto.randomUUID(), role: "assistant", content: assembled, createdAt: new Date().toISOString() }]);
    trackUiEvent("setup_engineer_recommendation_requested", { carId: selected.car.id, trackId: selected.track.id });
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error));
  } finally {
    setStreamingText(null);
    setAnalyzing(false);
  }
}

async function runEngineer() {
  const userText = feedback.trim();
  if (!userText) { setMessage("Escreva o que o carro está fazendo antes de enviar."); return; }
  await sendToEngineer(userText);
}

async function regenerateLast() {
  if (conversation.length === 0 || conversation[conversation.length - 1].role !== "assistant") return;
  await sendToEngineer(null);
}

async function resetConversation() {
  if (!selected) return;
  if (!confirm("Apagar todo o histórico desta conversa (carro + pista atuais)?")) return;
  await fetch(`/api/setup/engineer/chat?carId=${selected.car.id}&trackId=${selected.track.id}`, { method: "DELETE" });
  setConversation([]);
}

function copyMessage(content: string) {
  navigator.clipboard?.writeText(content).then(() => setMessage("Copiado.")).catch(() => setMessage("Não foi possível copiar."));
}
```

- [ ] **Step 6: Replace the engineer thread rendering (JSX)**

Replace this whole block:
```jsx
{conversation.length > 0 && (
  <div className="engineer-thread">
    {conversation.map((turn, index) => turn.role === "user" ? (
      <div className="engineer-turn user" key={index}><span>VOCÊ</span><p>{turn.text.replace(/\[\[([^\]]+)\]\]/g, "「$1」")}</p></div>
    ) : (
      <div className="engineer-turn assistant" key={index}>
        <span>ENGENHEIRO</span>
        <p className="engineer-turn-summary">{turn.result.summary}</p>
        {turn.result.recommendations.map((item) => (
          <article key={`${index}-${item.adjustment}-${item.direction}`}>
            <h4>{item.adjustment}</h4><b>{item.direction}</b><p>{item.why}</p>
            {item.parameter && <div className="engineer-parameter"><span>PARÂMETRO NO SEU SETUP</span><strong>{item.parameter.label}</strong><span>valor atual: {item.parameter.current}</span></div>}
            <small>Validar: {item.validate}</small>
          </article>
        ))}
        <p className="setup-guardrail">{turn.result.limitation}</p>
      </div>
    ))}
  </div>
)}
```
with:
```jsx
{loadingThread && <p className="engineer-loading">Carregando conversa...</p>}
{(conversation.length > 0 || streamingText !== null) && (
  <div className="engineer-thread">
    {conversation.map((msg) => msg.role === "user" ? (
      <div className="engineer-turn user" key={msg.id}><span>VOCÊ</span><p>{msg.content.replace(/\[\[([^\]]+)\]\]/g, "「$1」")}</p></div>
    ) : (
      <div className="engineer-turn assistant" key={msg.id}>
        <span>ENGENHEIRO</span>
        <div className="engineer-turn-markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
        <div className="engineer-turn-actions">
          <button type="button" onClick={() => copyMessage(msg.content)}>Copiar</button>
          {msg.id === conversation[conversation.length - 1]?.id && <button type="button" onClick={regenerateLast} disabled={analyzing}>Regenerar</button>}
        </div>
      </div>
    ))}
    {streamingText !== null && (
      <div className="engineer-turn assistant streaming">
        <span>ENGENHEIRO</span>
        <div className="engineer-turn-markdown"><ReactMarkdown>{streamingText || "..."}</ReactMarkdown></div>
      </div>
    )}
  </div>
)}
```

Add the import at the top of the file:
```typescript
import ReactMarkdown from "react-markdown";
```

Add a "Nova conversa" button next to the existing `engineer-actions` buttons:
```jsx
<div className="engineer-actions">
  <label className={`secondary-button ${uploading ? "disabled" : ""}`}>{uploading ? "Enviando..." : "Anexar setup"}<input type="file" accept=".sto,application/octet-stream" disabled={uploading || !selected} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadSetup(file, "commercial"); event.target.value = ""; }} /></label>
  {conversation.length > 0 && <button type="button" className="secondary-button" onClick={resetConversation}>Nova conversa</button>}
  <button className="primary-button" disabled={analyzing || (!activeSetupId && !mentionedSetupIds.length)} onClick={runEngineer}>{analyzing ? "Enviando..." : conversation.length ? "Enviar" : "Gerar recomendação"}</button>
</div>
```

- [ ] **Step 7: Verify the whole app builds and type-checks**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. (The `npm run build` Supabase-env failure noted in `CLAUDE.md`/this session's own history is a pre-existing local-environment issue unrelated to this change — if it recurs, confirm it also reproduces on `main` before this branch, don't treat it as this task's own regression.)

- [ ] **Step 8: Commit**

```bash
git add components/SetupLab.tsx package.json package-lock.json
git rm app/api/setup/engineer/route.ts
git commit -m "feat: rework Engenheiro tab into a real streaming chat UI"
```

---

### Task 6: CSS for the new chat UI

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: class names introduced in Task 5's JSX (`engineer-turn-markdown`, `engineer-turn-actions`, `engineer-loading`, `.streaming`).
- Produces: visual styling only, no new JS/TS interfaces.

- [ ] **Step 1: Find the existing `.engineer-*` rules**

```bash
grep -n "\.engineer-" app/globals.css
```
Read the existing rules for `.engineer-turn`, `.engineer-turn.user`, `.engineer-turn.assistant`, `.engineer-turn-summary`, `.engineer-parameter` before editing, so the new rules extend the same visual language (colors, spacing) instead of clashing with it.

- [ ] **Step 2: Add the new rules**

Add these alongside the existing `.engineer-turn*` block (exact placement: right after the last existing `.engineer-*` rule found in Step 1):

```css
.engineer-loading { color: var(--muted); font-size: 12px; font-family: var(--mono); margin: 8px 0; }
.engineer-turn-markdown { line-height: 1.55; }
.engineer-turn-markdown p { margin: 0 0 8px; }
.engineer-turn-markdown ul, .engineer-turn-markdown ol { margin: 0 0 8px; padding-left: 20px; }
.engineer-turn-markdown strong { color: var(--text); font-weight: 700; }
.engineer-turn-markdown code { font-family: var(--mono); font-size: 12px; background: var(--surface-muted); padding: 1px 4px; border-radius: 2px; }
.engineer-turn-actions { display: flex; gap: 8px; margin-top: 6px; }
.engineer-turn-actions button { background: none; border: 1px solid var(--border); color: var(--muted); font-size: 11px; font-family: var(--mono); padding: 3px 8px; border-radius: 3px; cursor: pointer; }
.engineer-turn-actions button:hover { color: var(--text); border-color: var(--border-strong); }
.engineer-turn.streaming .engineer-turn-markdown::after { content: "▋"; display: inline-block; margin-left: 2px; animation: engineer-cursor-blink 1s step-end infinite; color: var(--muted); }
@keyframes engineer-cursor-blink { 50% { opacity: 0; } }
```

- [ ] **Step 3: Visual check**

```bash
npm run dev
```
Open Setup Lab, "Engenheiro" tab, send a message, confirm: the streaming reply shows a blinking
cursor while arriving, Markdown (bold/lists) renders instead of raw `**`/`-` characters, and the
Copiar/Regenerar buttons appear under the latest assistant message.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "style: chat bubbles, streaming cursor and message actions for the engineer tab"
```

---

## After all tasks: deploy checklist (stop-and-ask, not a task)

This plan does not add `OPENAI_KEY` to Vercel or push/deploy — per this plan's own Global
Constraints, that needs the repo owner's own key value. Once all 6 tasks are done and reviewed:

1. Ask the repo owner for an OpenAI API key (or confirm reusing the `dashboard-psi` one under a
   new key scoped to this project).
2. `vercel env add OPENAI_KEY production` (same pattern already used for `GARAGE61_IMPORT_SECRET`/
   `LOCAL_COACH_SECRET` in this app's own history).
3. Push to `main`, confirm the Vercel deployment succeeds, then a real end-to-end smoke test on
   the deployed URL (same curl-based check as Task 4 Step 5, against the production domain).
