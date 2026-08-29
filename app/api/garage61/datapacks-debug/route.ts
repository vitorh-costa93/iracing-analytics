import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

// Temporary, one-off exploration of the Data Packs endpoints -- to check whether the driver's own
// setups (currently scraped via a browser bookmarklet, since no per-lap setup-download endpoint
// exists) are reachable this way instead. Delete once answered either way.
export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get("teamId");
    const datapackId = request.nextUrl.searchParams.get("datapackId");
    if (datapackId && teamId) {
      const content = await garage61Get(`/teams/${teamId}/datapacks/${datapackId}`);
      return NextResponse.json({ status: "ok", content });
    }
    if (teamId) {
      const datapacks = await garage61Get(`/teams/${teamId}/datapacks`);
      const datapackGroups = await garage61Get(`/teams/${teamId}/datapackgroups`);
      return NextResponse.json({ status: "ok", datapacks, datapackGroups });
    }
    const teams = await garage61Get("/teams");
    return NextResponse.json({ status: "ok", teams });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
