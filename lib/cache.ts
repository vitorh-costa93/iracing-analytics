import { revalidateTag, unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

// Shared server/CDN cache helpers. Tag -> routes map: docs/CACHE.md.
// Guard-rail (CLAUDE.md rule #7): these exist to cut Supabase egress/compute on the free tier.
export const CACHE_TAGS = {
  results: "results", // race_results / overview / report / debrief / inventory
  laps: "laps", // active-week, plan, car-comparison, baselines, race-field
  telemetryRef: "telemetry-ref",
  syncStatus: "sync-status",
} as const;
export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type CachedJsonOptions = { sMaxAge: number; swr?: number; tags: CacheTag[]; status?: number };

/** Public CDN-cacheable JSON. Only for routes without private setup/user content. Non-200 is never cached. */
export function cachedJson(body: unknown, { sMaxAge, swr = 0, tags, status = 200 }: CachedJsonOptions) {
  if (status !== 200) return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const control = `public, s-maxage=${Math.max(0, Math.floor(sMaxAge))}` + (swr > 0 ? `, stale-while-revalidate=${Math.floor(swr)}` : "");
  return NextResponse.json(body, { headers: { "Cache-Control": control, "Vercel-Cache-Tag": tags.join(",") } });
}

/** Error / non-cacheable JSON. */
export function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Data Cache wrapper (unstable_cache). Throwing inside fn is not cached. */
export function cachedQuery<T>(keyParts: (string | number | null | undefined)[], fn: () => Promise<T>, { tags, revalidate }: { tags: CacheTag[]; revalidate: number }): Promise<T> {
  const key = keyParts.map((part) => String(part ?? "")).join("|");
  return unstable_cache(fn, ["rc", key], { tags, revalidate })();
}

/** Invalidate Data Cache + Vercel CDN by tag. Never throws: a failed invalidation must not break a write route. */
export async function invalidate(...tags: CacheTag[]) {
  const unique = [...new Set(tags)];
  // Keep the last successful response available while new data is calculated.
  try {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { error } = await supabaseAdmin.rpc("invalidate_analytics_cache", { p_tags: unique });
    if (error) console.warn("durable cache invalidation failed", error.code);
  } catch { console.warn("durable cache invalidation unavailable"); }
  for (const tag of unique) {
    try { revalidateTag(tag); } catch (error) { console.warn("revalidateTag failed", tag, error instanceof Error ? error.message : error); }
  }
  try {
    const { invalidateByTag } = await import("@vercel/functions");
    await invalidateByTag(unique);
  } catch (error) {
    console.warn("invalidateByTag failed", error instanceof Error ? error.message : error);
  }
  try {
    const { waitUntil } = await import("@vercel/functions");
    const { warmAnalytics } = await import("@/lib/analytics-warm");
    waitUntil(warmAnalytics().catch(() => console.warn("analytics warm unavailable")));
  } catch { /* local/test runtimes need no background warming */ }
}

/** Wraps a write handler: after a successful (2xx) response, invalidates the given tags. Invalidation failures never affect the response. */
export function withInvalidate<A extends unknown[]>(handler: (...args: A) => Promise<Response>, tags: CacheTag[]) {
  return async (...args: A): Promise<Response> => {
    const response = await handler(...args);
    if (response.ok) await invalidate(...tags);
    return response;
  };
}
