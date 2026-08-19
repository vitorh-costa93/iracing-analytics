import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Recommendation = { adjustment: string; direction: string; why: string; validate: string };

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { setupId?: string; carId?: number; trackId?: number; feedback?: string };
    if (!body.setupId || !Number.isInteger(body.carId) || !Number.isInteger(body.trackId)) throw new Error("Selecione um setup, carro e pista");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");
    const { data: setup, error } = await supabaseAdmin.from("setup_files").select("id,filename,setup_kind,car_id,track_id").eq("id", body.setupId).eq("driver_id", driver.id).eq("car_id", body.carId).eq("track_id", body.trackId).single();
    if (error || !setup) throw new Error("Setup não encontrado neste contexto");

    const feedback = normalize(body.feedback?.trim() ?? "");
    const entry = /entrada|freio|frenagem|turn.?in/.test(feedback);
    const exit = /saida|acelera|tracao|potencia/.test(feedback);
    const understeer = /subester|sai de frente|frente escapa|nao vira|nao aponta/.test(feedback);
    const oversteer = /sobrester|traseira|rodar|escapa de traseira|instavel/.test(feedback);
    const traction = /patina|tracao|wheelspin|perde aderencia/.test(feedback);
    const recommendations: Recommendation[] = [];

    if (understeer && entry) recommendations.push(
      { adjustment: "Brake bias", direction: "Teste 0,25–0,50 p.p. para trás", why: "Ajuda o carro a rotacionar na fase inicial sem pedir mais volante.", validate: "Compare yaw rate, pico de volante e estabilidade da traseira na frenagem." },
      { adjustment: "Barra dianteira", direction: "Amoleça um clique", why: "Aumenta aderência mecânica dianteira no turn-in e meio da curva.", validate: "Confirme menor correção de volante sem piorar apoio em curva rápida." },
    );
    if (understeer && !entry) recommendations.push(
      { adjustment: "Balanço de barras", direction: "Amoleça a dianteira ou endureça a traseira um clique", why: "Desloca equilíbrio lateral para permitir mais rotação no meio da curva.", validate: "Procure maior aceleração lateral com o mesmo ângulo de volante." },
      { adjustment: "Diferencial em potência", direction: "Reduza o bloqueio em um passo", why: "Pode diminuir a tendência de abrir a trajetória durante a retomada.", validate: "Compare throttle, yaw rate e wheelspin na saída." },
    );
    if (oversteer && entry) recommendations.push(
      { adjustment: "Brake bias", direction: "Teste 0,25–0,50 p.p. para frente", why: "Reduz a rotação da traseira durante trail braking.", validate: "Confirme estabilidade sem criar subesterço excessivo na entrada." },
      { adjustment: "Diferencial em coast", direction: "Aumente o bloqueio em um passo", why: "Estabiliza o eixo traseiro na desaceleração.", validate: "Observe yaw rate ao soltar o freio e velocidade mínima." },
    );
    if (oversteer && !entry) recommendations.push(
      { adjustment: "Barra traseira", direction: "Amoleça um clique", why: "Entrega mais aderência mecânica atrás e reduz sobresterço sustentado.", validate: "Compare aceleração lateral, correções e temperatura dos pneus." },
    );
    if (traction || (oversteer && exit)) recommendations.push(
      { adjustment: "Tração traseira", direction: "Amoleça a traseira um passo e teste mais bloqueio apenas se houver patinagem de uma roda", why: "A prioridade é aumentar contato mecânico sem mascarar o problema com diferencial excessivo.", validate: "Use throttle, LongAccel, Steering e diferença de rotação das rodas quando disponível." },
    );
    if (!recommendations.length) recommendations.push(
      { adjustment: "Teste A/B controlado", direction: "Descreva entrada, meio ou saída e se o problema é frente, traseira ou tração", why: "Sem localizar a fase da curva, uma mudança de setup pode corrigir um trecho e piorar outro.", validate: "Faça três voltas consistentes, altere um item por vez e compare telemetria no mesmo combustível." },
    );

    return NextResponse.json({ status: "ok", setup: { id: setup.id, filename: setup.filename }, summary: `Plano preliminar para ${setup.filename}. As alterações abaixo são testes de direção; o .sto original não foi regravado.`, recommendations, limitation: "O formato binário .sto ainda não é regravado pelo servidor. Aplique um ajuste por vez no iRacing e valide na telemetria antes de consolidar." });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
