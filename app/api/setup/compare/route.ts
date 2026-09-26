import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CATEGORY_LABELS, DecodedRow, comparativeSummary, diffSetups } from "@/lib/setup-diff";
import { explainComparison } from "@/lib/setup-explain";
import { PANEL_GROUPS, plainParameterName, setupDisplayName, shortPairNames } from "@/lib/setup-names";

type SetupRow = { id: string; filename: string; storage_path: string; car_id: number; track_id: number; decoded_params: unknown; decoded_car_name: string | null };

async function decode(setup: SetupRow) {
  if (Array.isArray(setup.decoded_params)) return { carName: setup.decoded_car_name, rows: setup.decoded_params as DecodedRow[] };
  throw new Error(`O ${setupDisplayName(setup.filename)} ainda não tem parâmetros lidos pelo Garage61. Rode uma sessão com ele antes de comparar.`);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { baseSetupId?: string; comparisonSetupId?: string; carId?: number; trackId?: number };
    if (!body.baseSetupId || !body.comparisonSetupId || body.baseSetupId === body.comparisonSetupId) throw new Error("Selecione dois setups diferentes");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");
    const { data, error } = await supabaseAdmin.from("setup_files").select("id,filename,storage_path,car_id,track_id,decoded_params,decoded_car_name").eq("driver_id", driver.id).in("id", [body.baseSetupId, body.comparisonSetupId]);
    if (error || !data || data.length !== 2) throw new Error("Um dos setups não foi encontrado no cofre");
    const setups = data as SetupRow[];
    if (setups.some((item) => Number(item.car_id) !== body.carId || Number(item.track_id) !== body.trackId)) throw new Error("Os setups precisam pertencer ao carro e pista selecionados");
    const base = setups.find((item) => item.id === body.baseSetupId)!; const comparison = setups.find((item) => item.id === body.comparisonSetupId)!;
    const [baseDecoded, comparisonDecoded] = await Promise.all([decode(base), decode(comparison)]);
    if (baseDecoded.carName && comparisonDecoded.carName && baseDecoded.carName !== comparisonDecoded.carName) throw new Error("Os arquivos decodificados pertencem a carros diferentes");

    const changes = diffSetups(baseDecoded.rows, comparisonDecoded.rows);
    const actionable = changes.filter((change) => change.actionable);
    const skipped = changes.length - actionable.length;

    const byCategory = new Map<string, number>();
    for (const change of actionable) byCategory.set(change.category, (byCategory.get(change.category) ?? 0) + 1);
    const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, label: CATEGORY_LABELS[category] ?? category, count }));

    const numericChanges = actionable.filter((change) => change.numericDelta !== null && change.numericDelta !== 0);
    const topContributors = [...numericChanges].sort((a, b) => Math.abs(b.numericDelta as number) - Math.abs(a.numericDelta as number)).slice(0, 5)
      .map((change) => ({ label: plainParameterName(change.label, change.section), before: change.before, after: change.after, category: change.category }));

    // Redesign etapa 6: a fala usa o nome curto de cada setup (sem pasta nem extensão), não "Setup A/B".
    const baseName = setupDisplayName(base.filename), comparisonName = setupDisplayName(comparison.filename);
    const [spokenBase, spokenComparison] = shortPairNames(baseName, comparisonName);
    const summary = comparativeSummary(changes, spokenBase, spokenComparison);
    const explanation = explainComparison(actionable, spokenBase, spokenComparison);

    return NextResponse.json({
      status: "ok",
      base: { id: base.id, name: baseName },
      comparison: { id: comparison.id, name: comparisonName },
      carName: comparisonDecoded.carName ?? baseDecoded.carName,
      totalParameters: changes.length,
      changes: actionable.map((change) => ({ ...change, name: plainParameterName(change.label, change.section), group: PANEL_GROUPS[change.category] ?? "Outros" })),
      skippedCount: skipped,
      summary,
      explanation,
      analysis: { topCategories, topContributors },
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
