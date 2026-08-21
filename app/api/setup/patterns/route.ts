import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CATEGORY_LABELS, DecodedRow, diffSetups } from "@/lib/setup-diff";

type SetupRow = { id: string; car_id: number; track_id: number; setup_kind: string; filename: string; decoded_params: unknown; decoded_car_name: string | null; created_at: string };

export async function GET(request: NextRequest) {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");
    const { data, error } = await supabaseAdmin.from("setup_files").select("id,car_id,track_id,setup_kind,filename,decoded_params,decoded_car_name,created_at").eq("driver_id", driver.id).not("decoded_params", "is", null).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as SetupRow[];

    const [{ data: cars }, { data: tracks }] = await Promise.all([
      supabaseAdmin.from("cars").select("id,name"),
      supabaseAdmin.from("tracks").select("id,name,variant"),
    ]);
    const carNames = new Map((cars ?? []).map((row) => [Number(row.id), row.name]));
    const trackNames = new Map((tracks ?? []).map((row) => [Number(row.id), `${row.name}${row.variant ? ` (${row.variant})` : ""}`]));

    const byCar = new Map<number, SetupRow[]>();
    for (const row of rows) {
      if (!Array.isArray(row.decoded_params) || !(row.decoded_params as unknown[]).length) continue;
      byCar.set(row.car_id, [...(byCar.get(row.car_id) ?? []), row]);
    }

    const carSummaries = [...byCar.entries()].map(([carId, items]) => {
      const byTrack = new Map<number, SetupRow[]>();
      for (const item of items) byTrack.set(item.track_id, [...(byTrack.get(item.track_id) ?? []), item]);
      let pairedTracks = 0;
      for (const list of byTrack.values()) {
        const hasFixed = list.some((item) => item.setup_kind === "fixed");
        const hasOther = list.some((item) => item.setup_kind === "commercial" || item.setup_kind === "open");
        if (hasFixed && hasOther) pairedTracks += 1;
      }
      return { carId, carName: carNames.get(carId) ?? items[0]?.decoded_car_name ?? `Carro ${carId}`, pairedTracks, totalSetups: items.length };
    }).filter((car) => car.pairedTracks > 0).sort((a, b) => b.pairedTracks - a.pairedTracks);

    const carIdParam = Number(request.nextUrl.searchParams.get("carId"));
    const targetCarId = Number.isInteger(carIdParam) && byCar.has(carIdParam) ? carIdParam : carSummaries[0]?.carId;
    if (!targetCarId) return NextResponse.json({ status: "ok", cars: carSummaries, selected: null });

    const items = byCar.get(targetCarId) ?? [];
    const byTrack = new Map<number, SetupRow[]>();
    for (const item of items) byTrack.set(item.track_id, [...(byTrack.get(item.track_id) ?? []), item]);

    type Aggregate = { tab: string; section: string; label: string; category: string; occurrences: number; increases: number; decreases: number; examples: { track: string; before: string; after: string }[] };
    const aggregates = new Map<string, Aggregate>();
    let tracksAnalyzed = 0;
    const trackPairs: { trackId: number; trackName: string; fixedFile: string; comparisonFile: string; comparisonKind: string }[] = [];

    for (const [trackId, list] of byTrack) {
      const fixed = [...list].filter((item) => item.setup_kind === "fixed").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const commercial = [...list].filter((item) => item.setup_kind === "commercial").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const open = [...list].filter((item) => item.setup_kind === "open").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const other = commercial ?? open;
      if (!fixed || !other) continue;
      tracksAnalyzed += 1;
      trackPairs.push({ trackId, trackName: trackNames.get(trackId) ?? `Pista ${trackId}`, fixedFile: fixed.filename, comparisonFile: other.filename, comparisonKind: other.setup_kind });
      const changes = diffSetups(fixed.decoded_params as DecodedRow[], other.decoded_params as DecodedRow[]);
      for (const change of changes.filter((item) => item.actionable)) {
        const key = `${change.tab}::${change.section}::${change.label}`;
        const entry = aggregates.get(key) ?? { tab: change.tab, section: change.section, label: change.label, category: change.category, occurrences: 0, increases: 0, decreases: 0, examples: [] };
        entry.occurrences += 1;
        if (change.numericDelta !== null) { if (change.numericDelta > 0) entry.increases += 1; else if (change.numericDelta < 0) entry.decreases += 1; }
        entry.examples.push({ track: trackNames.get(trackId) ?? `Pista ${trackId}`, before: change.before, after: change.after });
        aggregates.set(key, entry);
      }
    }

    const parameters = [...aggregates.values()].map((entry) => {
      const directional = entry.increases + entry.decreases;
      const dominant = entry.increases >= entry.decreases ? entry.increases : entry.decreases;
      const consistencyPct = directional > 0 ? Math.round((dominant / directional) * 100) : null;
      const direction = directional === 0 ? "enum" : entry.increases === entry.decreases ? "mixed" : entry.increases > entry.decreases ? "increase" : "decrease";
      return {
        tab: entry.tab, section: entry.section, label: entry.label, category: entry.category, categoryLabel: CATEGORY_LABELS[entry.category] ?? entry.category,
        occurrences: entry.occurrences, tracksAnalyzed, coveragePct: Math.round((entry.occurrences / tracksAnalyzed) * 100),
        direction, consistencyPct, examples: entry.examples.slice(0, 6),
      };
    }).sort((a, b) => (b.consistencyPct ?? 0) * b.coveragePct - (a.consistencyPct ?? 0) * a.coveragePct || b.occurrences - a.occurrences);

    const strongPatterns = parameters.filter((p) => p.direction !== "mixed" && (p.consistencyPct ?? 0) >= 70 && p.coveragePct >= 50);

    return NextResponse.json({
      status: "ok",
      cars: carSummaries,
      selected: {
        carId: targetCarId,
        carName: carNames.get(targetCarId) ?? `Carro ${targetCarId}`,
        tracksAnalyzed,
        trackPairs,
        parameters,
        strongPatternsCount: strongPatterns.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
