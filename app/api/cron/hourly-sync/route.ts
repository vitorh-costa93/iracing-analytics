import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { GET as syncIrstatsIncremental } from "@/app/api/sync/irstats/route";

async function readStep(name: string, response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.message ?? response.statusText}`);
  return result;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const irstats = await readStep("irstats", await syncIrstatsIncremental(request));
    return NextResponse.json({ status: "ok", catalog, irstats });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
