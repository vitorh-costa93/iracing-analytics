import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: seasons, error: seasonError } = await db.from("v_season_summary").select("season_id,season_name");
if (seasonError) throw seasonError;
const current = [...seasons].sort((a, b) => Number(b.season_id) - Number(a.season_id))[0];
const { data: driver, error: driverError } = await db.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
if (driverError) throw driverError;
const { data: sessions, error: sessionsError } = await db.from("driving_sessions").select("garage61_event_id,car_id,track_id,started_at").eq("driver_id", driver.id).eq("season_id", current.season_id).eq("session_type", 3).order("started_at");
if (sessionsError) throw sessionsError;
const events = [...new Map(sessions.map((row) => [row.garage61_event_id, row])).values()];
console.log(JSON.stringify({ season: current, driverId: driver.id, events }));
