import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Temporary diagnostic route -- 29/08/2026, to find out why Indianapolis Ferrari/Mustang GT3 tests
// don't show up in the car-comparison tracks list. Delete once the root cause is confirmed/fixed.
export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("driver not found");

    const { data: tracks } = await supabaseAdmin.from("tracks").select("id,name,variant").ilike("name", "%Indianapolis%");

    const results = [];
    for (const track of tracks ?? []) {
      const { data: laps, error } = await supabaseAdmin
        .from("laps")
        .select("id,car_id,lap_time,clean,off_track,pit_lane,pit_in,pit_out,incomplete,missing,session_id")
        .eq("driver_id", driver.id).eq("track_id", track.id);
      if (error) throw error;
      const byCar = new Map<number, typeof laps>();
      for (const lap of laps ?? []) {
        if (!byCar.has(lap.car_id)) byCar.set(lap.car_id, []);
        byCar.get(lap.car_id)!.push(lap);
      }
      const carIds = [...byCar.keys()];
      const { data: carRows } = carIds.length ? await supabaseAdmin.from("cars").select("id,name").in("id", carIds) : { data: [] };
      const carNames = new Map((carRows ?? []).map((row) => [row.id, row.name]));

      const carSummaries = [...byCar.entries()].map(([carId, carLaps]) => {
        const valid = carLaps.filter((lap) => lap.clean && Number(lap.lap_time) > 0 && !lap.off_track && !lap.pit_lane && !lap.pit_in && !lap.pit_out && !lap.incomplete && !lap.missing);
        return {
          carId, carName: carNames.get(carId) ?? `Carro ${carId}`,
          totalLaps: carLaps.length, validLaps: valid.length,
          sampleRaw: carLaps.slice(0, 3).map((l) => ({ clean: l.clean, off_track: l.off_track, pit_lane: l.pit_lane, pit_in: l.pit_in, pit_out: l.pit_out, incomplete: l.incomplete, missing: l.missing, lap_time: l.lap_time })),
        };
      });

      results.push({ trackId: track.id, trackName: track.name, trackVariant: track.variant, cars: carSummaries });
    }

    return NextResponse.json({ status: "ok", driverId: driver.id, tracksFound: tracks, results });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
