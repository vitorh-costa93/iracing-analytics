import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SetupRow = { id: string; filename: string; storage_path: string; car_id: number; track_id: number; decoded_params: unknown; decoded_car_name: string | null };
type DecodedRow = { tab?: string; section?: string; label?: string; metric_value?: string | number; is_mapped?: boolean };

async function decode(setup: SetupRow) {
  if (Array.isArray(setup.decoded_params)) return { carName: setup.decoded_car_name, rows: setup.decoded_params as DecodedRow[] };
  throw new Error(`${setup.filename} ainda não possui parâmetros capturados pelo Garage61. Use uma sessão registrada com esse setup antes de compará-lo.`);
}

function effect(label: string, before: string, after: string) {
  const key = label.toLowerCase();
  const numeric = (value: string) => Number(value.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]);
  const from = numeric(before), to = numeric(after), increased = Number.isFinite(from) && Number.isFinite(to) ? to > from : null;
  if (/rear.*wing|wing.*angle|asa.*trase|gurney/.test(key)) return increased === null ? `A asa traseira ${before} → ${after} muda apoio e arrasto.` : increased ? `Mais asa traseira (${before} → ${after}) prende mais a traseira em curvas rápidas e na tração, mas aumenta o arrasto e reduz a velocidade de reta.` : `Menos asa traseira (${before} → ${after}) reduz o arrasto e aumenta a velocidade de reta, mas deixa a traseira mais solta e reduz a margem em curvas rápidas.`;
  if (/front.*wing|flap.*angle|asa.*diante/.test(key)) return increased ? `Mais asa dianteira (${before} → ${after}) aumenta resposta e aderência da frente em média/alta velocidade, mas pode deixar a traseira relativamente mais solta e elevar o arrasto.` : `Menos asa dianteira (${before} → ${after}) acalma a entrada, desloca o balanço para subesterço e normalmente reduz o arrasto.`;
  if (/wing|asa|aero/.test(key)) return `A mudança aerodinâmica ${before} → ${after} altera carga, balanço e arrasto; confira velocidade de reta e estabilidade em curva rápida.`;
  if (/brake bias|balance|freio/.test(key)) return increased === null ? `O brake bias ${before} → ${after} muda o equilíbrio em frenagem.` : increased ? `Mais brake bias dianteiro (${before} → ${after}) deixa o carro mais estável na frenagem, mas aumenta subesterço na entrada e sobrecarrega os pneus dianteiros.` : `Menos brake bias dianteiro (${before} → ${after}) deixa o carro mais traseiro e facilita a rotação na entrada, mas aumenta o risco de instabilidade e travamento traseiro no trail braking.`;
  if (/front.*arb|arb.*front|barra.*diante/.test(key)) return increased ? `Barra dianteira mais rígida (${before} → ${after}) dá resposta mais rápida, porém reduz aderência mecânica dianteira no meio da curva e tende a aumentar subesterço.` : `Barra dianteira mais macia (${before} → ${after}) aumenta aderência e tolerância a zebras na frente, mas deixa a resposta mais lenta e aumenta a rolagem.`;
  if (/rear.*arb|arb.*rear|barra.*trase/.test(key)) return increased ? `Barra traseira mais rígida (${before} → ${after}) ajuda o carro a rotacionar, mas reduz tração e pode provocar sobresterço.` : `Barra traseira mais macia (${before} → ${after}) melhora tração e estabilidade, mas tende a aumentar subesterço.`;
  if (/anti.?roll|arb|barra/.test(key)) return `A alteração ${before} → ${after} redistribui rigidez lateral; o efeito depende de o parâmetro atuar no eixo dianteiro ou traseiro.`;
  if (/spring|mola/.test(key)) return `A mudança de mola (${before} → ${after}) afeta plataforma aerodinâmica, resposta e capacidade de absorver zebras e ondulações.`;
  if (/ride height|altura/.test(key)) return `A altura ${before} → ${after} muda rake, curso disponível e plataforma aerodinâmica; valide também legalidade e contato com o solo.`;
  if (/camber|cambagem/.test(key)) return `A cambagem ${before} → ${after} altera contato do pneu em apoio, temperatura interna/externa e desempenho longitudinal.`;
  if (/toe|converg/.test(key)) return `O toe ${before} → ${after} modifica resposta inicial, estabilidade em reta, temperatura e arrasto dos pneus.`;
  if (/damp|shock|bump|rebound|amort/.test(key)) return `O amortecimento ${before} → ${after} muda a velocidade de transferência de carga em frenagem, rotação, zebra e retomada.`;
  if (/differential|diff|preload|coast|power/.test(key)) return `O diferencial ${before} → ${after} altera rotação em desaceleração e tração/estabilidade sob potência.`;
  if (/pressure|pressao/.test(key)) return `A pressão ${before} → ${after} afeta janela térmica, deformação, resposta e área de contato do pneu.`;
  if (/gear|ratio|marcha/.test(key)) return `A relação ${before} → ${after} muda aceleração, rotação e velocidade disponível nesse estágio.`;
  return `O parâmetro foi alterado de ${before} para ${after}; valide isoladamente o efeito em telemetria e consistência antes de adotá-lo.`;
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
    const mapped = (rows: DecodedRow[]) => new Map(rows.filter((row) => row.is_mapped !== false && row.label).map((row) => [`${row.tab ?? "Outro"}::${row.section ?? "Geral"}::${row.label}`, String(row.metric_value ?? "—")]));
    const a = mapped(baseDecoded.rows), b = mapped(comparisonDecoded.rows); const keys = [...new Set([...a.keys(), ...b.keys()])];
    const changes = keys.filter((key) => a.get(key) !== b.get(key)).map((key) => { const [tab, section, label] = key.split("::"); const before = a.get(key) ?? "—", after = b.get(key) ?? "—"; return { tab, section, label, before, after, explanation: effect(label, before, after) }; });
    return NextResponse.json({ status: "ok", base: { id: base.id, filename: base.filename }, comparison: { id: comparison.id, filename: comparison.filename }, carName: comparisonDecoded.carName ?? baseDecoded.carName, totalParameters: keys.length, changes, summary: changes.length ? `${changes.length} parâmetros diferem entre os setups selecionados.` : "Nenhuma diferença mapeada foi encontrada." });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
