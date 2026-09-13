# Engenheiro de Pista como Chat com IA — Design

## Context

Setup Lab's "Engenheiro" tab today (`components/SetupLab.tsx`, `app/api/setup/engineer/route.ts`)
is a rule-based expert system, not a conversation: every request is a fresh regex match against
the driver's free-text feedback, cross-referenced against a hard-coded knowledge base of
SF23/GT3/GTP setup behavior (ARB, differential, spring, brake bias — sourced from the official car
manuals). Two real limitations motivate this change (13/09/2026, driver's own words):

- **No memory.** `runEngineer()` sends only the current message; prior turns in `conversation`
  (client-side React state) are never included in the request, so the "conversation" is only
  visually stacked bubbles — each answer ignores everything asked before it.
- **No persistence.** `conversation` resets to `[]` on every car/track switch (`SetupLab.tsx`'s own
  `useEffect` keyed on `context`) and is lost entirely on page reload. There is no database table
  for it.

Confirmed with the driver (13/09/2026):
- Replace the rule-based engine with a real LLM (OpenAI, reusing the same provider/account already
  used in the sibling `dashboard-psi` project) — genuine multi-turn conversation, not reskinned
  pattern matching.
- One continuous conversation thread per `(car, track, season)` — not a ChatGPT-style sidebar of
  multiple saved conversations. Persisted so it survives reloads and returns exactly where it left
  off.
- "Categoria" (GT3/GTP/Formula) is derived from the car, not a separate scoping key or stored
  column — every car already belongs to exactly one category via the existing
  `car_group_members`/`car_rating_categories` tables.
- Chat polish that matters to the driver: streaming responses (text appears incrementally, not all
  at once), Markdown rendering (bold, lists) in assistant replies, and copy/regenerate actions on
  assistant messages.
- Raw telemetry (braking, cornering) is explicitly **out of scope** for this pass — the LLM's
  grounding data is the same decoded setup parameters the current engine already reads, nothing new
  fetched from `laps`/telemetry tables. A future pass could add it.

## Architecture

```text
components/SetupLab.tsx ("Engenheiro" tab, reworked as a real chat UI)
  -> GET  /api/setup/engineer/chat?carId=&trackId=   (load existing thread on car/track switch)
  -> POST /api/setup/engineer/chat                    (send a message; body: { carId, trackId,
                                                         message } or { carId, trackId,
                                                         regenerate: true })
       -> resolves current season (same v_season_calendar pattern app/api/setup/inventory/route.ts
          already uses), loads/creates the engineer_conversations row for
          (driver_id, season_id, carId, trackId)
       -> gathers grounding data: the row's own decoded setup params (setup_files.decoded_params
          for the driver's active/most-recent setup on this car+track), plus a structural diff
          (lib/setup-diff.ts's existing diffSetups/comparativeSummary — unchanged) when the
          message mentions two setups via [[filename]], same /setup mention UX as today
       -> builds a system prompt: the SAME car-specific ARB/differential/spring/brake-bias
          knowledge currently hard-coded in app/api/setup/engineer/route.ts's push*/*Target
          helper functions, now written as static grounding TEXT instead of executable branches
       -> calls OpenAI's Chat Completions API directly via fetch (mirrors dashboard-psi's
          api/_openai-retry.js pattern -- no openai SDK dependency added), stream: true
       -> re-emits a simplified plain-text delta stream to the browser (the route parses OpenAI's
          own SSE framing server-side so the client never needs to know OpenAI's wire format),
          accumulating the full text server-side as it streams
       -> once the stream ends, appends both the user message and the completed assistant message
          to engineer_conversations.messages and writes the row
  -> DELETE /api/setup/engineer/chat?carId=&trackId=   ("Nova conversa" -- clears the thread)
```

## Data model

New table, migration-only (additive, no changes to existing tables):

```sql
create table if not exists engineer_conversations (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id),
  season_id text not null,
  car_id integer not null,
  track_id integer not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, season_id, car_id, track_id)
);
```

`(driver_id, season_id, car_id, track_id)` mirrors `setup_files`'s own existing unique key
(`driver_id,season_id,car_id,track_id,filename`) exactly — same scoping convention already
established in this codebase, not a new one invented for this feature.

`messages` shape (one JSON array, no child table — this is a single-user app, thread sizes are
small, and reading/writing "the whole conversation" in one request is the natural access pattern;
a child table would only add join complexity with no real benefit here):

```ts
type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
```

## API contract

**`GET /api/setup/engineer/chat?carId=<id>&trackId=<id>`**
Resolves the current season server-side (same helper `app/api/setup/inventory/route.ts` already
has). Returns `{ status: "ok", messages: StoredMessage[] }` — `[]` if no thread exists yet for this
combination (not an error).

**`POST /api/setup/engineer/chat`**
Body: `{ carId: number; trackId: number; message: string }` to send a new message, or
`{ carId: number; trackId: number; regenerate: true }` to discard the last assistant message and
ask again from the same point (both share one handler: `regenerate` skips appending a new user
message and instead re-sends the existing last user message).

Response: `Content-Type: text/plain; charset=utf-8`, a streamed body of raw text chunks (the
assistant's reply, as it's generated — no envelope/framing, so the client's read loop can append
each chunk directly to the in-progress message). The full assembled reply plus the (possibly new)
user message are persisted to `engineer_conversations` after the stream completes, before the
response closes.

**`DELETE /api/setup/engineer/chat?carId=<id>&trackId=<id>`**
Clears the thread (`messages: []`) for "Nova conversa". Returns `{ status: "ok" }`.

## System prompt / grounding data

The prompt sent with every request has three parts:

1. **Static domain knowledge** — the ARB/differential/spring/brake-bias behavior per car
   architecture (SF23, GT3, GTP) currently encoded as executable branches in
   `app/api/setup/engineer/route.ts` (`arbTarget`, `differentialTarget`, `springTarget`, and their
   accompanying doc comments citing the official manuals) is rewritten as one static block of
   prose the LLM reads as ground truth, not thrown away. This includes the existing non-negotiable
   framing rules: always say explicitly whether to raise or lower the on-screen value (never just
   "stiffer"/"softer"), never invent an exact continuous target the car might not accept as a
   catalog step, and always disclose that `.sto` files aren't rewritten by this app.
2. **This car+track's real decoded setup data** — `setup_files.decoded_params` for the driver's
   active setup (same `activeSetupId` selection already in `SetupLab.tsx`), formatted as a compact
   parameter list, so the LLM answers using this driver's actual current values instead of generic
   advice. When the message mentions two setups via `[[filename]]` (unchanged UX), the existing
   `diffSetups`/`comparativeSummary` structural diff (`lib/setup-diff.ts`, untouched) is computed
   and included instead, so the "meio-termo" conversation is grounded in a real computed diff, not
   the LLM's own guess at what differs.
3. **Conversation history** — up to the last 20 stored messages (mirrors
   `dashboard-psi/api/post-content.js`'s own truncation: enough context for a real back-and-forth
   without unbounded token growth/cost as a thread gets long).

## UI (components/SetupLab.tsx, "Engenheiro" tab)

- Scrollable message list, auto-scrolls to the newest message. Assistant replies render Markdown
  (bold, lists) via a new `react-markdown` dependency (no existing Markdown renderer in this repo).
- Streaming: the in-progress assistant bubble grows as text arrives (`fetch` + `response.body`
  reader loop appending chunks to component state), with a small typing/cursor indicator until the
  stream ends.
- Per-assistant-message actions (shown on hover, matching the existing quiet/on-hover pattern
  already used elsewhere in this app's tables): **Copiar** (Clipboard API) and **Regenerar**
  (re-POSTs with `regenerate: true`, replacing that message in place).
- **Nova conversa** button clears the thread (`DELETE`) after a confirmation, matching this app's
  existing confirm-before-destructive-action convention.
- Loading an existing thread: `GET` fires whenever `context` (car+track key) changes, same
  `useEffect` that currently resets `conversation` to `[]` — replaced with the real fetch.
- The `/setup` two-setup-mention UX (`insertSetupMention`, `mentionedSetupIds`) is unchanged.

## Error handling

- `OPENAI_KEY` not configured on Vercel: the route returns a clear error
  (`{status:"error", message:"OPENAI_KEY não configurada"}`) before attempting any network call —
  same pattern `lib/supabase-admin.ts` already uses for its own missing-env-var case.
- OpenAI request failure (5xx/429/timeout): mirrors `dashboard-psi/api/_openai-retry.js`'s own
  `fetchComRetentativa` — retry with backoff on transient failures, surface a plain error to the
  chat (as a system-style message in the thread, not a silent failure) on final failure. No retry
  on 4xx (our own request is malformed; retrying won't help).
- A network drop mid-stream: whatever text arrived is kept visible in the UI (not discarded), but
  is **not** persisted as a complete assistant turn (an incomplete answer saved as if it were
  finished would corrupt the next request's context) — the driver can hit Regenerar.

## Testing

- `lib/setup-diff.ts` is unchanged and already tested — no new tests needed there.
- New unit tests for the system-prompt-building function (given decoded params / a diff, produces
  the expected grounding text) — this is the part of the old regex engine's domain knowledge that
  must survive the rewrite intact, so it gets the same "shaping logic, not re-testing the
  underlying math" test treatment already used for `local-coach-baselines.ts`.
- The OpenAI streaming call itself is not unit-tested (network I/O to a third-party API) — same
  practical boundary this app already draws around Garage61/iRStats calls.

## Out of scope for this pass

- Raw telemetry (braking, cornering) as LLM context.
- Multiple saved conversations per car+track+season (ChatGPT-style sidebar).
- Category as a separate stored/filterable dimension (it's derived from car_id when needed).
- Rewriting/regrading the `.sto` file — unchanged limitation, still disclosed to the driver.
