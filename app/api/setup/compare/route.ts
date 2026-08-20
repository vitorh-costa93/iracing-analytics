import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SetupRow = { id: string; filename: string; storage_path: string; car_id: number; track_id: number; decoded_params: unknown; decoded_car_name: string | null };
type DecodedRow = { tab?: string; section?: string; label?: string; metric_value?: string | number; is_mapped?: boolean };

async function decode(setup: SetupRow) {
  if (Array.isArray(setup.decoded_params)) return { carName: setup.decoded_car_name, rows: setup.decoded_params as DecodedRow[] };
  throw new Error(`${setup.filename} ainda não possui parâmetros capturados pelo Garage61. Use uma sessão registrada com esse setup antes de compará-lo.`);
}

function effect(label: string, before: string, after: string, section?: string, tab?: string) {
  const key = label.toLowerCase();
  const sectionKey = (section ?? "").toLowerCase();
  const numeric = (value: string) => Number(value.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]);
  const from = numeric(before), to = numeric(after), increased = Number.isFinite(from) && Number.isFinite(to) ? to > from : null;
  const isFront = /front|diant/.test(sectionKey) || /front|diant/.test(key);
  const isRear = /rear|trase/.test(sectionKey) || /rear|trase/.test(key);
  const axleLabel = isFront ? "dianteir" : isRear ? "traseir" : null;

  if (/display|dash|page|shift light|led|alert/.test(key)) return `Ajuste de exibição no painel/dash (${before} → ${after}); não altera o comportamento físico do carro, só a informação mostrada ao piloto.`;

  if (/rear.*wing|wing.*angle|asa.*trase|gurney/.test(key)) return increased === null ? `A asa traseira ${before} → ${after} muda apoio e arrasto.` : increased ? `Mais asa traseira (${before} → ${after}) prende mais a traseira em curvas rápidas e na tração, mas aumenta o arrasto e reduz a velocidade de reta.` : `Menos asa traseira (${before} → ${after}) reduz o arrasto e aumenta a velocidade de reta, mas deixa a traseira mais solta e reduz a margem em curvas rápidas.`;
  if (/front.*wing|flap.*angle|asa.*diante/.test(key)) return increased ? `Mais asa dianteira (${before} → ${after}) aumenta resposta e aderência da frente em média/alta velocidade, mas pode deixar a traseira relativamente mais solta e elevar o arrasto.` : `Menos asa dianteira (${before} → ${after}) acalma a entrada, desloca o balanço para subesterço e normalmente reduz o arrasto.`;
  if (/wing|asa|aero/.test(key)) return `A mudança aerodinâmica ${before} → ${after} altera carga, balanço e arrasto; confira velocidade de reta e estabilidade em curva rápida.`;
  if (/brake bias|balance|freio/.test(key)) return increased === null ? `O brake bias ${before} → ${after} muda o equilíbrio em frenagem.` : increased ? `Mais brake bias dianteiro (${before} → ${after}) deixa o carro mais estável na frenagem, mas aumenta subesterço na entrada e sobrecarrega os pneus dianteiros.` : `Menos brake bias dianteiro (${before} → ${after}) deixa o carro mais traseiro e facilita a rotação na entrada, mas aumenta o risco de instabilidade e travamento traseiro no trail braking.`;
  if (/anti.?roll|arb|barra/.test(key)) {
    if (axleLabel === "dianteir") return increased ? `Barra dianteira mais rígida (${before} → ${after}) dá resposta mais rápida na entrada, porém reduz aderência mecânica dianteira no meio da curva e tende a aumentar subesterço, principalmente em curvas de baixa velocidade.` : `Barra dianteira mais macia (${before} → ${after}) aumenta aderência e tolerância a zebras na frente, mas deixa a resposta de direção mais lenta e aumenta a rolagem dianteira.`;
    if (axleLabel === "traseir") return increased ? `Barra traseira mais rígida (${before} → ${after}) ajuda o carro a rotacionar na entrada e no meio da curva, mas reduz tração na saída e pode provocar sobresterço em curvas rápidas ou pista molhada.` : `Barra traseira mais macia (${before} → ${after}) melhora tração na saída e estabilidade em curvas rápidas, mas tende a aumentar subesterço no meio da curva.`;
    return `A alteração na barra estabilizadora (${before} → ${after}) redistribui rigidez lateral entre os pneus daquele eixo; combinada com o eixo oposto, define o balanço geral entre subesterço e sobresterço.`;
  }
  if (/spring|mola/.test(key)) {
    const axlePhrase = axleLabel ? `no eixo ${axleLabel}o` : "";
    return increased === null ? `A mudança de mola ${axlePhrase} (${before} → ${after}) afeta a plataforma aerodinâmica, a resposta a transferência de carga e a capacidade de absorver zebras e ondulações.` : increased ? `Mola mais dura ${axlePhrase} (${before} → ${after}) mantém a plataforma mais estável sob carga aerodinâmica e frenagem, mas transmite mais impacto de zebras/ondulações e reduz aderência mecânica em pista irregular.` : `Mola mais macia ${axlePhrase} (${before} → ${after}) melhora absorção de zebras e aderência mecânica, mas aumenta a variação de altura sob carga, o que pode instabilizar a aerodinâmica em alta velocidade.`;
  }
  if (/ride height|altura/.test(key)) return `A altura ${axleLabel ? `${axleLabel}a ` : ""}(${before} → ${after}) muda o rake do carro, o curso de suspensão disponível e a plataforma aerodinâmica; valide também legalidade mínima e risco de fundo raspando no chão.`;
  if (/camber|cambagem/.test(key)) return `A cambagem ${axleLabel ? `${axleLabel}a ` : ""}(${before} → ${after}) altera a área de contato do pneu em apoio lateral, a temperatura interna/externa do pneu e o desempenho em frenagem/tração longitudinal.`;
  if (/toe|converg/.test(key)) return `O toe ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) modifica a resposta inicial de direção, a estabilidade em reta, a geração de temperatura e o arrasto dos pneus.`;
  if (/damp|shock|bump|rebound|amort/.test(key)) {
    const isBump = /bump|compress/.test(key), isRebound = /rebound|extens/.test(key);
    if (isBump) return `O amortecimento de compressão ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) controla a velocidade com que a suspensão absorve zebras e transferência de carga em frenagem/curva; mais rígido responde mais rápido mas transmite mais impacto.`;
    if (isRebound) return `O amortecimento de extensão ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) controla a velocidade de retomada do pneu no solo após compressão; mais rígido reduz oscilação mas pode "empacar" o carro em sequência de curvas e zebras.`;
    return `O amortecimento ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) muda a velocidade de transferência de carga em frenagem, rotação, zebra e retomada de aderência.`;
  }
  if (/differential|diff|preload|coast|power/.test(key)) return `O diferencial (${before} → ${after}) altera a rotação do carro em desaceleração/entrada de curva (coast) e a tração/estabilidade sob potência na saída (power); mais travado tende a estabilizar em reta e reduzir rotação na entrada.`;
  if (/pressure|pressao/.test(key)) return `A pressão ${axleLabel ? `${axleLabel} ` : ""}(${before} → ${after}) afeta a janela térmica de trabalho do pneu, a deformação da carcaça, a resposta de direção e a área de contato; pressão muito baixa superaquece o pneu, muito alta reduz aderência.`;
  if (/gear|ratio|marcha/.test(key)) return `A relação de marcha (${before} → ${after}) muda a aceleração disponível, a faixa de rotação usada e a velocidade máxima naquele estágio; confira se ainda bate no limitador antes das retas mais longas.`;
  if (/steering|direção|ackerman/.test(key)) return `O ajuste de geometria de direção (${before} → ${after}) altera a relação entre o ângulo das rodas interna e externa em curva, afetando o esterçamento e o desgaste do pneu dianteiro interno.`;
  return `O parâmetro em ${tab ?? "Setup"} • ${section ?? "Geral"} foi alterado de ${before} para ${after}; sem uma regra específica mapeada ainda — valide isoladamente o efeito em telemetria (frenagem, rotação e tração) antes de adotá-lo em corrida.`;
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
    const changes = keys.filter((key) => a.get(key) !== b.get(key)).map((key) => { const [tab, section, label] = key.split("::"); const before = a.get(key) ?? "—", after = b.get(key) ?? "—"; return { tab, section, label, before, after, explanation: effect(label, before, after, section, tab) }; });
    return NextResponse.json({ status: "ok", base: { id: base.id, filename: base.filename }, comparison: { id: comparison.id, filename: comparison.filename }, carName: comparisonDecoded.carName ?? baseDecoded.carName, totalParameters: keys.length, changes, summary: changes.length ? `${changes.length} parâmetros diferem entre os setups selecionados.` : "Nenhuma diferença mapeada foi encontrada." });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
