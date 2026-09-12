import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";

describe("GET /api/telemetry/local-coach/baselines", () => {
  const originalSecret = process.env.LOCAL_COACH_SECRET;
  // lib/supabase-admin.ts constructs its client (and throws if these are unset) at module-import
  // time, before either test's auth/param short-circuit runs -- these are never used to reach a real
  // Supabase project since both tests return before any DB call, but the module import needs
  // *some* non-empty values to not throw. This worktree has no .env.local (gitignored, not copied
  // by `git worktree add`), so seed placeholders only when real ones aren't already present.
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  beforeEach(() => { process.env.LOCAL_COACH_SECRET = "test-secret"; });
  afterEach(() => { process.env.LOCAL_COACH_SECRET = originalSecret; });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("rejects a request without the correct x-import-key header", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/telemetry/local-coach/baselines?car=1&track=2");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("rejects a request missing car or track query params", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/telemetry/local-coach/baselines?car=1", {
      headers: { "x-import-key": "test-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(400);
  });
});
