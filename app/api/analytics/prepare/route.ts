import { waitUntil } from "@vercel/functions";
import { isAnalyticsWarm } from "@/lib/durable-cache";
import { warmAnalytics } from "@/lib/analytics-warm";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAnalyticsWarm(request)) return Response.json({ status: "error" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  waitUntil(warmAnalytics().catch(() => console.warn("analytics preparation failed")));
  return Response.json({ status: "accepted" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
