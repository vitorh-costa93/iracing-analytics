import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { garage61Get } from "@/lib/garage61";

// Temporary diagnostic route -- 29/08/2026, comparing what's synced into the local `laps` table
// against what Garage61 itself reports for a track, to find sync gaps (Spa GT3 missing most of the
// Ferrari 296 GT3 / Ford Mustang GT3 / McLaren data the driver knows exists). Delete after use.
export async function GET(request: Request) {
  try {
    const trackId = Number(new URL(request.url).searchParams.get("trackId"));
    if (!Number.isFinite(trackId)) return NextResponse.json({ status: "error", message: "trackId required" }, { status: 400 });

    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("driver not found");

    const { data: laps, error } = await supabaseAdmin
      .from("laps")
      .select("id,car_id,lap_time,clean,off_track,session_id,synced_at")
      .eq("driver_id", driver.id).eq("track_id", trackId);
    if (error) throw error;
    const byCarLocal = new Map<number, { total: number; withSession: number; earliestSynced: string; latestSynced: string }>();
    for (const lap of laps ?? []) {
      const entry = byCarLocal.get(lap.car_id) ?? { total: 0, withSession: 0, earliestSynced: lap.synced_at, latestSynced: lap.synced_at };
      entry.total += 1;
      if (lap.session_id) entry.withSession += 1;
      if (lap.synced_at < entry.earliestSynced) entry.earliestSynced = lap.synced_at;
      if (lap.synced_at > entry.latestSynced) entry.latestSynced = lap.synced_at;
      byCarLocal.set(lap.car_id, entry);
    }
    const localCarIds = [...byCarLocal.keys()];
    const { data: carRows } = localCarIds.length ? await supabaseAdmin.from("cars").select("id,name").in("id", localCarIds) : { data: [] };
    const carNames = new Map((carRows ?? []).map((row) => [row.id, row.name]));

    const g61 = await garage61Get<{ items: { car?: { id: number; name?: string }; startTime?: string }[]; total?: number }>(
      "/laps", { tracks: trackId, drivers: "me", group: "none", unclean: "true", lapTypes: "1,2,3,4", limit: 1000, offset: 0 }
    );
    const byCarG61 = new Map<string, { count: number; earliest: string; latest: string }>();
    for (const lap of g61.items ?? []) {
      const name = lap.car?.name ?? `car ${lap.car?.id}`;
      const entry = byCarG61.get(name) ?? { count: 0, earliest: lap.startTime ?? "", latest: lap.startTime ?? "" };
      entry.count += 1;
      if (lap.startTime && lap.startTime < entry.earliest) entry.earliest = lap.startTime;
      if (lap.startTime && lap.startTime > entry.latest) entry.latest = lap.startTime;
      byCarG61.set(name, entry);
    }

    // Also check daily_statistics -- laps-all only iterates tracks present there.
    const { data: stats } = await supabaseAdmin.from("daily_statistics").select("statistic_date").eq("driver_id", driver.id).eq("track_id", trackId).order("statistic_date", { ascending: false }).limit(3);

    return NextResponse.json({
      status: "ok",
      local: [...byCarLocal.entries()].map(([carId, info]) => ({ carId, carName: carNames.get(carId) ?? `Carro ${carId}`, ...info })),
      garage61Direct: { total: g61.total, itemsReturned: g61.items?.length ?? 0, byCar: [...byCarG61.entries()].map(([name, info]) => ({ name, ...info })) },
      dailyStatsRecent: stats,
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
