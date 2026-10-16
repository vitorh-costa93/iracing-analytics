import { createHash, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";

type Options = { version: string; tags: string[]; ttlSeconds: number; maxBytes?: number; maxStaleSeconds?: number; cacheKeySuffix?: string; validUntil?: (payload: unknown) => number | null; visibility?: "public" | "private" };
type Entry = { payload: unknown; generated_at: string; refresh_after: string; invalidated_at?: string; version: string };
const TABLE = "analytics_response_cache";
const HARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_SECONDS = 300;

function isOkPayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "status" in payload && payload.status === "ok";
}

export function isAnalyticsWarm(request: Request): boolean {
  const supplied = request.headers.get("x-analytics-warm");
  if (!supplied) return false;
  return [process.env.IMPORT_KEY, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(secret), actual = Buffer.from(supplied);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

function annotated(response: Response, status: string, noStore = false): Response {
  // Rebuild so immutable Fetch responses are supported too; retain the original stream.
  const headers = new Headers(response.headers);
  headers.set("X-Analytics-Cache", status);
  if (noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Only wrap explicitly approved single-user GET routes; private visibility disables CDN.
 * This cache does not partition by user or replace authentication. Payloads must have status: "ok".
 * Ordinary cookies are intentionally ignored. Authorization and ?refresh bypass storage.
 * x-analytics-warm=<IMPORT_KEY or CRON_SECRET> forces synchronous regeneration.
 */
export function withDurableCache<R extends Request>(handler: (request: R) => Promise<Response>, options: Options) {
  if (!options.version || !Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new Error("Durable cache requires a version and positive ttlSeconds");
  }
  const maxBytes = options.maxBytes ?? 1_500_000;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("Invalid durable cache maxBytes");
  const hardTtlMs = Math.min((options.maxStaleSeconds ?? HARD_TTL_MS / 1000) * 1000, HARD_TTL_MS);
  if (!Number.isFinite(hardTtlMs) || hardTtlMs <= 0) throw new Error("Invalid durable cache maxStaleSeconds");
  const inFlight = new Map<string, Promise<Response>>();
  let dbModule: Promise<typeof import("./supabase-admin")> | undefined;

  const serve = async (request: R): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== "GET" || request.headers.has("authorization") || url.searchParams.has("refresh")) {
      return annotated(await handler(request), "BYPASS", true);
    }
    const warm = isAnalyticsWarm(request);
    // URLSearchParams.sort is stable: duplicate values retain handler .get() semantics.
    const params = new URLSearchParams(url.searchParams);
    params.sort();
    const key = createHash("sha256").update(JSON.stringify([url.pathname, params.toString(), options.version, options.cacheKeySuffix ?? ""])).digest("hex");
    let db: (typeof import("./supabase-admin"))["supabaseAdmin"];
    let entry: Entry | null = null;
    try {
      db = (await (dbModule ??= import("./supabase-admin"))).supabaseAdmin;
      const result = await db.from(TABLE).select("payload,generated_at,refresh_after,invalidated_at,version").eq("key", key).maybeSingle();
      if (result.error) throw result.error;
      entry = result.data as Entry | null;
    } catch {
      dbModule = undefined;
      return annotated(await handler(request), "UNAVAILABLE", true);
    }

    const compute = async (): Promise<Response> => {
      const startedAt = new Date().toISOString();
      const response = await handler(request);
      if (!response.ok || response.headers.has("set-cookie") || !response.headers.get("content-type")?.includes("application/json")) {
        return annotated(response, "SKIP", true);
      }
      try {
        const body = await response.clone().text();
        if (Buffer.byteLength(body, "utf8") > maxBytes) return annotated(response, "SKIP");
        const payload: unknown = JSON.parse(body);
        if (!isOkPayload(payload)) return annotated(response, "SKIP", true);
        // The RPC serializes persistence against invalidation so an in-flight computation
        // cannot overwrite a newer invalidation with a fresh TTL.
        const { data, error } = await db.rpc("store_analytics_cache", {
          p_key: key, p_route: url.pathname + (params.size ? `?${params.toString()}` : ""),
          p_tags: options.tags, p_payload: payload, p_version: options.version,
          p_started_at: startedAt, p_ttl_seconds: Math.max(1, Math.floor(Math.min(options.ttlSeconds, hardTtlMs / 1000))),
        });
        if (!error && data !== true) return annotated(response, "SKIP", true);
        const result = annotated(response, error ? "UNAVAILABLE" : warm ? "REFRESH" : "MISS", warm || !!error);
        if (!warm && !error) {
          const boundary = options.validUntil?.(payload) ?? Infinity;
          const seconds = Math.max(0, Math.floor((Math.min(Date.parse(startedAt) + options.ttlSeconds * 1000, Date.parse(startedAt) + hardTtlMs, boundary) - Date.now()) / 1000));
          result.headers.set("Cache-Control", seconds > 0 ? `public, s-maxage=${seconds}` : "no-store");
        }
        return result;
      } catch {
        return annotated(response, "UNAVAILABLE", true);
      }
    };
    const computeCold = async () => {
      const pending = inFlight.get(key) ?? compute();
      inFlight.set(key, pending);
      try { return (await pending).clone(); }
      finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
    };

    const now = Date.now();
    const generated = Date.parse(entry?.generated_at ?? "");
    const refreshAfter = Date.parse(entry?.refresh_after ?? "");
    const validUntil = entry ? options.validUntil?.(entry.payload) ?? Infinity : Infinity;
    const invalidatedAt = Date.parse(entry?.invalidated_at ?? "");
    const dirtyExpired = invalidatedAt > generated && now - invalidatedAt >= 15 * 60_000;
    const usable = entry && entry.version === options.version && isOkPayload(entry.payload)
      && Number.isFinite(generated) && generated <= now && now - generated < hardTtlMs && Number.isFinite(refreshAfter) && now < validUntil && !dirtyExpired;
    if (entry && (warm || !usable)) {
      try {
        const { data, error } = await db.rpc("claim_analytics_cache_refresh", { p_key: key, p_lease_seconds: LEASE_SECONDS });
        if (!error && data === true) return compute();
      } catch { /* A denied or unavailable lease must not bypass the refresh budget. */ }
      if (!usable) return Response.json({ status: "unavailable", message: "Cache refresh unavailable" }, {
        status: 503, headers: { "Cache-Control": "no-store", "X-Analytics-Cache": "UNAVAILABLE" },
      });
    } else if (!usable) return computeCold();
    // The usable guard above guarantees a stored response, including denied warm requests.
    if (!entry) return computeCold();

    const stale = refreshAfter <= now;
    if (stale && !warm) {
      const refresh = async () => {
        try {
          const { data, error } = await db.rpc("claim_analytics_cache_refresh", { p_key: key, p_lease_seconds: LEASE_SECONDS });
          if (!error && data === true) await compute();
        } catch { /* Refresh failures keep the last good payload until the hard horizon. */ }
      };
      const pending = refresh();
      try { waitUntil(pending); } catch { /* Local runtimes may lack a waitUntil context. */ }
    }
    const remaining = Math.max(0, Math.floor((Math.min(refreshAfter, generated + hardTtlMs, validUntil) - now) / 1000));
    return Response.json(entry.payload, { headers: {
      "X-Analytics-Cache": stale ? "STALE" : "HIT",
      "X-Analytics-Generated-At": entry.generated_at,
      "Cache-Control": stale || warm ? "no-store" : `public, s-maxage=${remaining}`,
      "Vercel-Cache-Tag": options.tags.join(","),
    } });
  };
  return async (request: R): Promise<Response> => {
    const response = await serve(request);
    if (options.visibility !== "private") return response;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-cache");
    headers.delete("Vercel-Cache-Tag");
    headers.delete("Vercel-CDN-Cache-Control");
    headers.delete("CDN-Cache-Control");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
