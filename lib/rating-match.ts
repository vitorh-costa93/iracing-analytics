import { supabaseAdmin } from "@/lib/supabase-admin";

const WINDOW_HOURS = 6;
const CATEGORIES = ["formula_car", "sports_car"] as const;

type SessionRow = { id: number; car_id: number; ended_at: string };
type RatingRow = { recorded_at: string; rating: number };

/**
 * Pairs each race (driving_sessions, session_type=3) with the iRating change it caused, using a
 * greedy monotonic (chronological) matching: process races in time order, and for each one assign
 * the EARLIEST still-unused rating change within a 6h window after it ends. Each rating change is
 * consumed at most once and matches never go backwards in time, so a short/aborted race can no
 * longer "steal" a rating change that actually belongs to a longer race ending slightly earlier —
 * the bug in the previous nearest-neighbor-per-change heuristic.
 *
 * rating_history holds far more entries than captured races (it's the account's full iRacing
 * history via Garage61, not just races we've synced), so a strict 1:1 global pairing would
 * misalign everything; this only ever matches within the local 6h window, leaving races or
 * changes with no plausible partner unmatched rather than guessing.
 */
export async function recomputeRatingMatches(driverId: string) {
  const { data: categoryRows, error: categoryError } = await supabaseAdmin.from("car_rating_categories").select("car_id,rating_category");
  if (categoryError) throw categoryError;
  const carCategory = new Map<number, string>();
  for (const row of categoryRows ?? []) carCategory.set(row.car_id, row.rating_category);

  let totalMatched = 0;
  const upsertRows: {
    session_id: number; driver_id: string; rating_category: string; rating_at: string;
    previous_rating: number; new_rating: number; delta_irating: number; gap_hours: number;
  }[] = [];

  for (const category of CATEGORIES) {
    const carIds = [...carCategory.entries()].filter(([, c]) => c === category).map(([id]) => id);
    if (!carIds.length) continue;

    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from("driving_sessions").select("id,car_id,ended_at")
      .eq("driver_id", driverId).eq("session_type", 3).in("car_id", carIds)
      .order("ended_at", { ascending: true });
    if (sessionsError) throw sessionsError;

    const { data: ratings, error: ratingsError } = await supabaseAdmin
      .from("rating_history").select("recorded_at,rating")
      .eq("driver_id", driverId).eq("category", category).eq("rating_type", "irating")
      .order("recorded_at", { ascending: true });
    if (ratingsError) throw ratingsError;

    const changes: { recorded_at: string; previous: number; rating: number; used: boolean }[] = [];
    for (let i = 1; i < (ratings ?? []).length; i += 1) {
      const prev = (ratings as RatingRow[])[i - 1], curr = (ratings as RatingRow[])[i];
      if (curr.rating !== prev.rating) changes.push({ recorded_at: curr.recorded_at, previous: prev.rating, rating: curr.rating, used: false });
    }

    let pointer = 0;
    for (const session of (sessions ?? []) as SessionRow[]) {
      const endMs = new Date(session.ended_at).getTime();
      while (pointer < changes.length && new Date(changes[pointer].recorded_at).getTime() < endMs) pointer += 1;
      let foundIndex: number | null = null;
      for (let j = pointer; j < changes.length; j += 1) {
        if (changes[j].used) continue;
        const gapHours = (new Date(changes[j].recorded_at).getTime() - endMs) / 3_600_000;
        if (gapHours > WINDOW_HOURS) break;
        foundIndex = j;
        break;
      }
      if (foundIndex === null) continue;
      const change = changes[foundIndex];
      change.used = true;
      const gapHours = (new Date(change.recorded_at).getTime() - endMs) / 3_600_000;
      upsertRows.push({
        session_id: session.id, driver_id: driverId, rating_category: category, rating_at: change.recorded_at,
        previous_rating: change.previous, new_rating: change.rating, delta_irating: change.rating - change.previous,
        gap_hours: Number(gapHours.toFixed(3)),
      });
      totalMatched += 1;
    }
  }

  if (upsertRows.length) {
    const CHUNK = 500;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const { error } = await supabaseAdmin.from("race_rating_matches").upsert(upsertRows.slice(i, i + CHUNK), { onConflict: "session_id" });
      if (error) throw error;
    }
  }

  // Remove matches for sessions that no longer resolve to a match this run (e.g. window shifted).
  const matchedIds = upsertRows.map((row) => row.session_id);
  const { error: pruneError } = await supabaseAdmin.from("race_rating_matches").delete().eq("driver_id", driverId).not("session_id", "in", `(${matchedIds.join(",") || "0"})`);
  if (pruneError) throw pruneError;

  return { totalMatched };
}
