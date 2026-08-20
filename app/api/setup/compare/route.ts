import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SetupRow = { id: string; filename: string; storage_path: string; car_id: number; track_id: number; decoded_params: unknown; decoded_car_name: string | null };
type DecodedRow = { tab?: string; section?: string; label?: string; metric_value?: string | number; is_mapped?: boolean };

async function decode(setup: SetupRow) {
  if (Array.isArray(setup.decoded_params)) return { carName: setup.decoded_car_name, rows: setup.decoded_params as DecodedRow[] };
  const { data: blob, error } = await supabaseAdmin.storage.from("private-setups").download(setup.storage_path);
  if (error || !blob) throw new Error(`Não foi possível ler ${setup.filename} do cofre privado`);
  const form = new FormData(); form.set("file", new File([await blob.arrayBuffer()], setup.filename, { type: "application/octet-stream" }));
  const response = await fetch("https://www.setupdelta.com/api/setup/decode", { method: "POST", headers: { Origin: "https://www.setupdelta.com", Referer: "https://www.setupdelta.com/" }, body: form, signal: AbortSignal.timeout(25000), cache: "no-store" });
  if (!response.ok) {
    if (response.status === 410) throw new Error("O decodificador externo do SetupDelta foi retirado. Seus arquivos continuam seguros no cofre; exporte também o Garage Setup em HTML no iRacing para habilitar um comparativo sem depender desse serviço.");
    throw new Error(response.status === 422 ? `${setup.filename} não é suportado pelo decodificador` : `O decodificador externo respondeu ${response.status} para ${setup.filename}`);
  }
  const result = await response.json() as { carName?: string; rows?: DecodedRow[] };
  if (!Array.isArray(result.rows) || !result.rows.length) throw new Error(`O decodificador não retornou parâmetros para ${setup.filename}`);
  const consentAt = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin.from("setup_files").update({ decoded_car_name: result.carName ?? null, decoded_params: result.rows, decoded_at: consentAt, decoder: "setupdelta.com", external_decode_consent_at: consentAt }).eq("id", setup.id);
  if (updateError) throw updateError;
  return { carName: result.carName ?? null, rows: result.rows };
}

function effect(label: string, before: string, after: string) {
  const key = label.toLowerCase();
  if (/wing|asa|aero/.test(key)) return `A mudança de ${before} para ${after} altera carga e arrasto; mais asa tende a aumentar apoio e estabilidade, com custo de velocidade final.`;
  if (/brake bias|balance|freio/.test(key)) return `Mover de ${before} para ${after} redistribui a frenagem: mais dianteiro estabiliza, mais traseiro ajuda rotação e aumenta o risco de instabilidade.`;
  if (/anti.?roll|arb|barra/.test(key)) return `A alteração de ${before} para ${after} muda a distribuição de rigidez lateral e, portanto, o equilíbrio entre rotação e aderência mecânica do eixo.`;
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
    const body = await request.json() as { baseSetupId?: string; comparisonSetupId?: string; carId?: number; trackId?: number; consent?: boolean };
    if (!body.consent) throw new Error("É necessário autorizar o envio dos dois arquivos ao SetupDelta");
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
    return NextResponse.json({ status: "ok", base: { id: base.id, filename: base.filename }, comparison: { id: comparison.id, filename: comparison.filename }, carName: comparisonDecoded.carName ?? baseDecoded.carName, totalParameters: keys.length, changes, summary: changes.length ? `${changes.length} parâmetros diferem entre o fixed e o comercial.` : "Nenhuma diferença mapeada foi encontrada." });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
