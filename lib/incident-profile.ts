import { supabaseAdmin } from "@/lib/supabase-admin";
import { Category, RaceInput } from "@/lib/race-engineer-analysis";

type Payload = { season?: { name?: string }; sessionType?: number; tow?: boolean; towed?: boolean; };
const norm = (value: string) => value.trim().toLocaleLowerCase();

export async function incidentProfile(driverId: string, category: Category, rows: RaceInput[], seasonName: string) {
  const carNames = new Set(rows.map((row) => norm(row.car_name)));
  if (!carNames.size) return { samples: 0, offTrack: 0, incomplete: 0, discontinuity: 0, pitEvent: 0, towConfirmed: 0, retirementSignal: 0, note: "Sem corridas suficientes para associar flags de volta." };

  const [{ data: cars, error: carsError }, { data: laps, error: lapsError }] = await Promise.all([
    supabaseAdmin.from("cars").select("id,name"),
    supabaseAdmin.from("laps").select("car_id,off_track,incomplete,discontinuity,missing,pit_lane,pit_in,pit_out,garage61_payload").eq("driver_id", driverId),
  ]);
  if (carsError) throw carsError;
  if (lapsError) throw lapsError;
  const eligibleCars = new Set((cars ?? []).filter((car) => car.name && carNames.has(norm(car.name))).map((car) => car.id));
  const items = (laps ?? []).filter((lap) => {
    const payload = (lap.garage61_payload ?? {}) as Payload;
    return eligibleCars.has(lap.car_id) && payload.season?.name === seasonName && (payload.sessionType === 2 || payload.sessionType === 3);
  });
  const count = (test: (lap: typeof items[number], payload: Payload) => boolean) => items.filter((lap) => test(lap, (lap.garage61_payload ?? {}) as Payload)).length;
  const offTrack = count((lap) => lap.off_track === true);
  const incomplete = count((lap) => lap.incomplete === true || lap.missing === true);
  const discontinuity = count((lap) => lap.discontinuity === true);
  const pitEvent = count((lap) => lap.pit_lane === true || lap.pit_in === true || lap.pit_out === true);
  const towConfirmed = count((_lap, payload) => payload.tow === true || payload.towed === true);
  const retirementSignal = count((lap, payload) => (lap.discontinuity === true || lap.incomplete === true || lap.missing === true) && (lap.pit_in === true || lap.pit_out === true || payload.tow === true || payload.towed === true));
  return {
    samples: items.length, offTrack, incomplete, discontinuity, pitEvent, towConfirmed, retirementSignal,
    note: "Flags são contadas por volta de sessão de corrida. Off-track é explícito; tow só é confirmado quando o payload o nomeia. Pit + volta interrompida é sinal de retirada, não prova de colisão.",
  };
}