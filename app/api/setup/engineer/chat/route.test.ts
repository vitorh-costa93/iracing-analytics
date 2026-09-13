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
