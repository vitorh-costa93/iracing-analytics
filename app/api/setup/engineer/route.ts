import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DecodedRow } from "@/lib/setup-diff";

type Recommendation = { adjustment: string; direction: string; why: string; validate: string; parameter: { label: string; current: string } | null };

function normalize(value: string) { return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

function findParam(rows: DecodedRow[], pattern: RegExp, sectionPattern?: RegExp) {
  const match = rows.find((row) => row.label && pattern.test(row.label) && (!sectionPattern || sectionPattern.test(row.section ?? "")));
  if (!match) return null;
  return { label: `${match.tab ?? "Setup"} • ${match.section ?? "Geral"} • ${match.label}`, current: String(match.metric_value ?? "—") };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { setupId?: string; carId?: number; trackId?: number; feedback?: string };
    if (!body.setupId || !Number.isInteger(body.carId) || !Number.isInteger(body.trackId)) throw new Error("Selecione um setup, carro e pista");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");
    const { data: setup, error } = await supabaseAdmin.from("setup_files").select("id,filename,setup_kind,car_id,track_id,decoded_params").eq("id", body.setupId).eq("driver_id", driver.id).eq("car_id", body.carId).eq("track_id", body.trackId).single();
    if (error || !setup) throw new Error("Setup não encontrado neste contexto");

    const decodedRows: DecodedRow[] = Array.isArray(setup.decoded_params) ? (setup.decoded_params as DecodedRow[]) : [];
    const hasDecoded = decodedRows.length > 0;

    const feedback = normalize(body.feedback?.trim() ?? "");
    const entry = /entrada|freio|frenagem|turn.?in/.test(feedback);
    const exit = /saida|acelera|tracao|potencia/.test(feedback);
    const understeer = /subester|sai de frente|frente escapa|nao vira|nao aponta/.test(feedback);
    const oversteer = /sobrester|traseira|rodar|escapa de traseira|instavel/.test(feedback);
    const traction = /patina|tracao|wheelspin|perde aderencia/.test(feedback);
    const recommendations: Recommendation[] = [];

    const push = (adjustment: string, direction: string, why: string, validate: string, pattern: RegExp, sectionPattern?: RegExp) => {
      recommendations.push({ adjustment, direction, why, validate, parameter: hasDecoded ? findParam(decodedRows, pattern, sectionPattern) : null });
    };

    if (understeer && entry) {
      push("Brake bias", "Teste 0,25–0,50 p.p. para trás", "Ajuda o carro a rotacionar na fase inicial sem pedir mais volante.", "Compare yaw rate, pico de volante e estabilidade da traseira na frenagem.", /brake.*bias|bias/i);
      push("Barra dianteira", "Amoleça um clique", "Aumenta aderência mecânica dianteira no turn-in e meio da curva.", "Confirme menor correção de volante sem piorar apoio em curva rápida.", /arb/i, /front|diant/i);
    }
    if (understeer && !entry) {
      push("Balanço de barras", "Amoleça a dianteira ou endureça a traseira um clique", "Desloca equilíbrio lateral para permitir mais rotação no meio da curva.", "Procure maior aceleração lateral com o mesmo ângulo de volante.", /arb/i);
      push("Diferencial em potência", "Reduza o bloqueio em um passo", "Pode diminuir a tendência de abrir a trajetória durante a retomada.", "Compare throttle, yaw rate e wheelspin na saída.", /power|coast|diff/i);
    }
    if (oversteer && entry) {
      push("Brake bias", "Teste 0,25–0,50 p.p. para frente", "Reduz a rotação da traseira durante trail braking.", "Confirme estabilidade sem criar subesterço excessivo na entrada.", /brake.*bias|bias/i);
      push("Diferencial em coast", "Aumente o bloqueio em um passo", "Estabiliza o eixo traseiro na desaceleração.", "Observe yaw rate ao soltar o freio e velocidade mínima.", /coast/i);
    }
    if (oversteer && !entry) {
      push("Barra traseira", "Amoleça um clique", "Entrega mais aderência mecânica atrás e reduz sobresterço sustentado.", "Compare aceleração lateral, correções e temperatura dos pneus.", /arb/i, /rear|trase/i);
    }
    if (traction || (oversteer && exit)) {
      push("Tração traseira (barra ou mola traseira)", "Amoleça a traseira um passo e teste mais bloqueio apenas se houver patinagem de uma roda", "A prioridade é aumentar contato mecânico sem mascarar o problema com diferencial excessivo.", "Use throttle, LongAccel, Steering e diferença de rotação das rodas quando disponível.", /arb|spring/i, /rear|trase/i);
    }
    if (!recommendations.length) {
      recommendations.push({ adjustment: "Teste A/B controlado", direction: "Descreva entrada, meio ou saída e se o problema é frente, traseira ou tração", why: "Sem localizar a fase da curva, uma mudança de setup pode corrigir um trecho e piorar outro.", validate: "Faça três voltas consistentes, altere um item por vez e compare telemetria no mesmo combustível.", parameter: null });
    }

    return NextResponse.json({
      status: "ok",
      setup: { id: setup.id, filename: setup.filename },
      summary: `Plano preliminar para ${setup.filename}. As alterações abaixo são testes de direção; o .sto original não foi regravado.`,
      recommendations,
      hasDecodedParameters: hasDecoded,
      limitation: hasDecoded
        ? "O formato binário .sto ainda não é regravado pelo servidor. Aplique um ajuste por vez no iRacing e valide na telemetria antes de consolidar."
        : "Este setup ainda não tem parâmetros decodificados (só chega via Garage61), então as sugestões abaixo são genéricas — não apontam o valor exato do seu setup. Use um setup já usado em corrida para recomendações com o parâmetro e valor atual citados.",
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
