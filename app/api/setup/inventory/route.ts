import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Payload = { id?: string; startTime?: string; season?: { id?: string | number }; sessionType?: number; canViewSetup?: boolean };

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
  const seasonEnd = new Date(new Date(current.season_start).getTime() + 84 * 86_400_000).toISOString();
  return { driverId: driver.id, seasonId: String(current.season_id), seasonName: current.season_name, seasonStart: current.season_start, seasonEnd };
}

export async function GET(request: NextRequest) {
  try {
    const { driverId, seasonId, seasonName, seasonStart, seasonEnd } = await context();
    const [sessionsResult, setupsResult, lapsResult] = await Promise.all([
      supabaseAdmin.from("race_results").select("car_id,track_id,raced_at").eq("driver_id", driverId).gte("raced_at", seasonStart).lt("raced_at", seasonEnd),
      supabaseAdmin.from("setup_files").select("id,car_id,track_id,source,setup_kind,filename,file_size,created_at,decoded_at,decoder").eq("driver_id", driverId).eq("season_id", seasonId).order("created_at", { ascending: false }),
      supabaseAdmin.from("laps").select("id,car_id,track_id,can_view_setup,garage61_payload").eq("driver_id", driverId).limit(5000),
    ]);
    if (sessionsResult.error) throw sessionsResult.error;
    if (setupsResult.error) throw setupsResult.error;
    if (lapsResult.error) throw lapsResult.error;

    const pairMap = new Map<string, { carId: number; trackId: number; races: number; lastRace: string | null }>();
    for (const row of sessionsResult.data ?? []) {
      if (row.car_id === null || row.track_id === null) continue;
      const key = `${row.car_id}:${row.track_id}`;
      const current = pairMap.get(key) ?? { carId: Number(row.car_id), trackId: Number(row.track_id), races: 0, lastRace: null };
      current.races += 1;
      if (!current.lastRace || (row.raced_at && row.raced_at > current.lastRace)) current.lastRace = row.raced_at;
      pairMap.set(key, current);
    }
    const carIds = [...new Set([...pairMap.values()].map((item) => item.carId))];
    const trackIds = [...new Set([...pairMap.values()].map((item) => item.trackId))];
    const [carsResult, tracksResult] = await Promise.all([
      carIds.length ? supabaseAdmin.from("cars").select("id,name,variant").in("id", carIds) : Promise.resolve({ data: [], error: null }),
      trackIds.length ? supabaseAdmin.from("tracks").select("id,name,variant").in("id", trackIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (carsResult.error) throw carsResult.error;
    if (tracksResult.error) throw tracksResult.error;
    const cars = new Map((carsResult.data ?? []).map((item) => [Number(item.id), item]));
    const tracks = new Map((tracksResult.data ?? []).map((item) => [Number(item.id), item]));

    const seasonLaps = (lapsResult.data ?? []).filter((row) => (row.garage61_payload as Payload | null)?.season?.id === seasonId);

    // Was: a live Garage61 call every time a car/track pair got selected here, overriding the
    // already-synced `laps` table for that one pair. Beyond being the exact "hits the API on every
    // page view" pattern this whole rework is fixing, it meant a Garage61 rate-limit (or any
    // transient failure) made a pair look like it had NO accessible setup at all, even when the
    // synced data already knew better -- reads Supabase only now, same as everything else here.
    const contexts = [...pairMap.entries()].map(([key, pair]) => {
      const relevant = seasonLaps.filter((lap) => Number(lap.car_id) === pair.carId && Number(lap.track_id) === pair.trackId);
      const observed = relevant.map((lap) => ({ id: lap.id, canViewSetup: lap.can_view_setup }));
      const uploads = (setupsResult.data ?? []).filter((setup) => Number(setup.car_id) === pair.carId && Number(setup.track_id) === pair.trackId);
      const visibleLap = observed.find((lap) => lap.canViewSetup);
      const car = cars.get(pair.carId), track = tracks.get(pair.trackId);
      return {
        key,
        car: { id: pair.carId, name: car?.name ?? `Carro ${pair.carId}`, variant: car?.variant ?? null },
        track: { id: pair.trackId, name: track?.name ?? `Pista ${pair.trackId}`, variant: track?.variant ?? null },
        races: pair.races,
        lastRace: pair.lastRace,
        garage61: { scanned: relevant.length > 0, accessible: Boolean(visibleLap), accessibleLapId: visibleLap?.id ?? null, observedLaps: observed.length },
        uploads,
      };
    }).sort((a, b) => (b.lastRace ?? "").localeCompare(a.lastRace ?? ""));
    return NextResponse.json({ status: "ok", season: { id: seasonId, name: seasonName }, contexts });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file"), carId = Number(form.get("carId")), trackId = Number(form.get("trackId"));
    const setupKind = String(form.get("setupKind") ?? "commercial");
    if (!(file instanceof File) || !Number.isInteger(carId) || !Number.isInteger(trackId)) throw new Error("Arquivo, carro ou pista inválidos");
    if (!file.name.toLowerCase().endsWith(".sto")) throw new Error("Envie um arquivo .sto do iRacing");
    if (!["commercial", "fixed", "open", "unknown"].includes(setupKind)) throw new Error("Tipo de setup inválido");
    if (file.size < 32 || file.size > 5 * 1024 * 1024) throw new Error("O setup deve ter entre 32 bytes e 5 MB");
    const { driverId, seasonId } = await context();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${driverId}/${seasonId}/${carId}/${trackId}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: storageError } = await supabaseAdmin.storage.from("private-setups").upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
    if (storageError) throw storageError;
    const { data, error } = await supabaseAdmin.from("setup_files").upsert({ driver_id: driverId, season_id: seasonId, car_id: carId, track_id: trackId, source: setupKind === "commercial" ? "manual_commercial" : "manual_upload", setup_kind: setupKind, filename: file.name, storage_path: path, file_size: file.size, decoded_params: null, decoded_at: null, decoder: null, external_decode_consent_at: null, updated_at: new Date().toISOString() }, { onConflict: "driver_id,season_id,car_id,track_id,filename" }).select("id,filename,file_size,setup_kind,created_at").single();
    if (error) { await supabaseAdmin.storage.from("private-setups").remove([path]); throw error; }
    return NextResponse.json({ status: "ok", setup: data });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
