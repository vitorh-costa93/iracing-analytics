import { gzipSync, gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  usedToday: 0,
  objects: new Map<string, Buffer>(),
  downloads: [] as string[],
  recorded: [] as Array<{ p_bytes: number; p_blocked: boolean }>,
  uploads: [] as Array<{ path: string; body: Buffer; contentType?: string }>,
  lapUpdates: [] as Array<{ values: unknown; id: string }>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "telemetry_download_usage") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { bytes: state.usedToday }, error: null }) }) }) };
      }
      return { update: (values: unknown) => ({ eq: async (_col: string, id: string) => { state.lapUpdates.push({ values, id }); return { error: null }; } }) };
    },
    rpc: async (_name: string, args: { p_bytes: number; p_blocked: boolean }) => { state.recorded.push(args); return { error: null }; },
    storage: {
      from: () => ({
        download: async (path: string) => {
          state.downloads.push(path);
          const body = state.objects.get(path);
          return body ? { data: new Blob([new Uint8Array(body)]), error: null } : { data: null, error: new Error("not found") };
        },
        upload: async (path: string, body: Buffer, opts: { contentType?: string }) => { state.uploads.push({ path, body, contentType: opts?.contentType }); return { error: null }; },
      }),
    },
  },
}));

const mod = await import("./telemetry-storage");

beforeEach(() => {
  state.usedToday = 0; state.objects.clear(); state.downloads = []; state.recorded = []; state.uploads = []; state.lapUpdates = [];
});

describe("telemetry-storage", () => {
  it("gunzips .csv.gz laps (routes used to parse the raw gzip bytes as text)", async () => {
    state.objects.set("laps/1/a.csv.gz", gzipSync(Buffer.from("t,x\n1,2\n")));
    expect(await mod.readTelemetryText("laps/1/a.csv.gz")).toBe("t,x\n1,2\n");
  });

  it("reads plain .csv laps unchanged and records the downloaded bytes", async () => {
    state.objects.set("laps/1/b.csv", Buffer.from("t,x\n3,4\n"));
    expect(await mod.readTelemetryText("laps/1/b.csv")).toBe("t,x\n3,4\n");
    expect(state.recorded).toEqual([{ p_bytes: 8, p_blocked: false }]);
  });

  it("refuses to download once the daily budget is reached", async () => {
    state.usedToday = mod.TELEMETRY_DAILY_DOWNLOAD_BUDGET_BYTES;
    state.objects.set("laps/1/c.csv", Buffer.from("x"));
    expect(await mod.readTelemetryText("laps/1/c.csv")).toBeNull();
    expect(state.downloads).toEqual([]);
    expect(state.recorded).toEqual([{ p_bytes: 0, p_blocked: true }]);
  });

  it("serves a repeated read from the in-memory cache without downloading again", async () => {
    state.objects.set("laps/1/d.csv", Buffer.from("t\n1\n"));
    await mod.readTelemetryText("laps/1/d.csv");
    await mod.readTelemetryText("laps/1/d.csv");
    expect(state.downloads).toEqual(["laps/1/d.csv"]);
  });

  it("stores live-fetched CSVs gzipped as .csv.gz, never as plain .csv", async () => {
    const path = await mod.storeTelemetryCsv(7, "lap-9", "t,x\n5,6\n");
    expect(path).toBe("laps/7/lap-9.csv.gz");
    expect(state.uploads[0].contentType).toBe("application/gzip");
    expect(gunzipSync(state.uploads[0].body).toString()).toBe("t,x\n5,6\n");
    expect(state.lapUpdates).toEqual([{ values: { telemetry_path: "laps/7/lap-9.csv.gz" }, id: "lap-9" }]);
  });
});
