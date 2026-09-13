import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };

// Copied from app/api/setup/inventory/route.ts's own context() -- this codebase's established
// convention is one small inline copy per route, not a shared lib helper (no existing route shares
// this query via lib/ either).
async function context() {
  const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
  if (driverError || !driver) throw new Error("Piloto não encontrado");
  const { data: current, error: seasonError } = await supabaseAdmin
    .from("v_season_calendar")
    .select("season_id, season_name, season_start")
    .order("season_start", { ascending: false })
    .limit(1)
    .single();
  if (seasonError || !current) throw new Error("Season atual não encontrada");
  return { driverId: driver.id as string, seasonId: String(current.season_id) };
}

function parseCarTrack(url: string): { carId: number; trackId: number } {
  const { searchParams } = new URL(url);
  const carIdParam = searchParams.get("carId");
  const trackIdParam = searchParams.get("trackId");
  const carId = Number(carIdParam);
  const trackId = Number(trackIdParam);
  if (!carIdParam || !trackIdParam || !Number.isInteger(carId) || !Number.isInteger(trackId)) throw new Error("carId e trackId são obrigatórios");
  return { carId, trackId };
}

export async function GET(request: NextRequest) {
  try {
    const { carId, trackId } = parseCarTrack(request.url);
    const { driverId, seasonId } = await context();
    const { data, error } = await supabaseAdmin
      .from("engineer_conversations")
      .select("messages")
      .eq("driver_id", driverId).eq("season_id", seasonId).eq("car_id", carId).eq("track_id", trackId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ status: "ok", messages: (data?.messages as StoredMessage[] | undefined) ?? [] });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { carId, trackId } = parseCarTrack(request.url);
    const { driverId, seasonId } = await context();
    const { error } = await supabaseAdmin
      .from("engineer_conversations")
      .delete()
      .eq("driver_id", driverId).eq("season_id", seasonId).eq("car_id", carId).eq("track_id", trackId);
    if (error) throw error;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
