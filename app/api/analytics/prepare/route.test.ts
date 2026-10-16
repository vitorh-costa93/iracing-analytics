import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ allowed: false, warm: vi.fn(async () => {}), wait: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.wait }));
vi.mock("@/lib/durable-cache", () => ({ isAnalyticsWarm: () => mocks.allowed }));
vi.mock("@/lib/analytics-warm", () => ({ warmAnalytics: mocks.warm }));
import { POST } from "./route";
beforeEach(() => { mocks.allowed = false; mocks.warm.mockClear(); mocks.wait.mockClear(); });
it("rejects unauthenticated preparation without doing work", async () => {
  const response = await POST(new Request("https://example.test/api/analytics/prepare", { method: "POST" }));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.warm).not.toHaveBeenCalled();
});
it("acknowledges authorized preparation and extends its own function lifetime", async () => {
  mocks.allowed = true;
  expect((await POST(new Request("https://example.test/api/analytics/prepare", { method: "POST" }))).status).toBe(202);
  expect(mocks.warm).toHaveBeenCalledOnce();
  expect(mocks.wait).toHaveBeenCalledWith(expect.any(Promise));
});
