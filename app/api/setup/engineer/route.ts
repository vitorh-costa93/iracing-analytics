import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DecodedRow } from "@/lib/setup-diff";

type ParamHit = { tab: string; section: string; label: string; current: string };
type Recommendation = { adjustment: string; direction: string; why: string; validate: string; parameter: { label: string; current: string } | null };

function normalize(value: string) { return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

function findParams(rows: DecodedRow[], pattern: RegExp, sectionPattern?: RegExp): ParamHit[] {
  return rows.filter((row) => row.label && pattern.test(row.label) && (!sectionPattern || sectionPattern.test(row.section ?? "")))
    .map((row) => ({ tab: row.tab ?? "Setup", section: row.section ?? "Geral", label: row.label as string, current: String(row.metric_value ?? "—") }));
}

function parseValueUnit(value: string): { number: number; unit: string } | null {
  const match = value.match(/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  return { number: Number(match[1]), unit: match[2].trim() };
}

/**
 * Describes an adjustment as an explicit "aumente" or "diminua" the on-screen number, so the
 * driver always knows which arrow/dropdown direction to click — never just "mais macio", which
 * doesn't say whether that means a higher or lower number for this specific parameter.
 * We don't guess an arithmetic target for continuous values (N/mm, mm, deg, %) because each car
 * only accepts specific catalog steps that we don't have mapped, and a made-up number could be
 * impossible to select in the game. Damper clicks are the one exception: ±1 click always works.
 * `raise === null` means the direction genuinely depends on the differential/car and we say so
 * instead of guessing.
 */
function concreteTarget(hit: ParamHit, raise: boolean | null): string {
  const parsed = parseValueUnit(hit.current);
  if (raise === null) return `valor atual ${hit.current} — a direção certa depende do tipo de diferencial deste carro; teste um passo em cada sentido no menu e compare qual reduz o problema`;
  const verb = raise ? "Aumente" : "Diminua";
  if (!parsed) return `${verb} o valor a partir do atual (${hit.current}) no menu do carro`;
  const { number, unit } = parsed;
  if (/clicks|click/i.test(unit)) {
    const target = raise ? number + 1 : number - 1;
    return `${hit.current} → ${target >= 0 ? "+" : ""}${target} clicks (1 clique ${raise ? "a mais" : "a menos"})`;
  }
  // Continuous-looking values (N/mm, mm, deg, %) só aceitam degraus específicos do catálogo do
  // carro, que não temos mapeados — por isso apontamos a direção sem inventar o número exato.
  return `${verb} o valor a partir do atual (${hit.current}) — use a seta/dropdown do próprio jogo para o próximo valor disponível nessa direção, ele já respeita os limites do carro`;
}

function describeParams(hits: ParamHit[]): { label: string; current: string } | null {
  if (!hits.length) return null;
  if (hits.length === 1) return { label: `${hits[0].tab} • ${hits[0].section} • ${hits[0].label}`, current: hits[0].current };
  const sameValue = hits.every((hit) => hit.current === hits[0].current);
  return {
    label: `${hits[0].tab} • ${hits.map((hit) => hit.section).join(" / ")} • ${hits[0].label}`,
    current: sameValue ? hits[0].current : hits.map((hit) => `${hit.section}: ${hit.current}`).join(" | "),
  };
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

    /** Builds a recommendation whose "direction" text always says explicitly to raise or lower the on-screen value. */
    const push = (adjustment: string, why: string, validate: string, pattern: RegExp, sectionPattern: RegExp | undefined, raise: boolean | null, fallbackDirection: string) => {
      const hits = hasDecoded ? findParams(decodedRows, pattern, sectionPattern) : [];
      const parameter = describeParams(hits);
      const direction = hits.length ? concreteTarget(hits[0], raise) : fallbackDirection;
      recommendations.push({ adjustment, direction, why, validate, parameter });
    };

    if (understeer && entry) {
      push("Brake bias", "Ajuda o carro a rotacionar na fase inicial sem pedir mais volante.", "Compare yaw rate, pico de volante e estabilidade da traseira na frenagem.", /brake.*bias|bias/i, undefined, false, "Diminua 0,25–0,50 p.p. (menos bias dianteiro)");
      push("Barra estabilizadora dianteira", "Aumenta aderência mecânica dianteira no turn-in e meio da curva.", "Confirme menor correção de volante sem piorar apoio em curva rápida.", /arb.*diameter|diameter.*arb/i, /front|diant/i, false, "Diminua (barra mais fina/macia)");
    }
    if (understeer && !entry) {
      push("Barra estabilizadora dianteira", "Desloca equilíbrio lateral para permitir mais rotação no meio da curva.", "Procure maior aceleração lateral com o mesmo ângulo de volante.", /arb.*diameter|diameter.*arb/i, /front|diant/i, false, "Diminua (barra mais fina/macia)");
      push("Diferencial em potência (power)", "Pode diminuir a tendência de abrir a trajetória durante a retomada.", "Compare throttle, yaw rate e wheelspin na saída.", /power/i, undefined, null, "Reduza o bloqueio em power um passo (confirme o sentido no menu do carro)");
    }
    if (oversteer && entry) {
      push("Brake bias", "Reduz a rotação da traseira durante trail braking.", "Confirme estabilidade sem criar subesterço excessivo na entrada.", /brake.*bias|bias/i, undefined, true, "Aumente 0,25–0,50 p.p. (mais bias dianteiro)");
      push("Diferencial em coast", "Estabiliza o eixo traseiro na desaceleração.", "Observe yaw rate ao soltar o freio e velocidade mínima.", /coast/i, undefined, null, "Aumente o bloqueio em coast um passo (confirme o sentido no menu do carro)");
    }
    if (oversteer && !entry) {
      push("Barra estabilizadora traseira", "Entrega mais aderência mecânica atrás e reduz sobresterço sustentado.", "Compare aceleração lateral, correções e temperatura dos pneus entre os dois lados.", /arb.*diameter|diameter.*arb/i, /rear|trase/i, false, "Diminua (barra mais fina/macia)");
    }
    if (traction || (oversteer && exit)) {
      push("Mola traseira (ambos os lados)", "A prioridade é aumentar contato mecânico sem mascarar o problema com diferencial excessivo.", "Use throttle, LongAccel, Steering e diferença de rotação das rodas quando disponível; ajuste os dois lados juntos, não só um.", /spring.?rate/i, /^(left rear|right rear)$/i, false, "Diminua (mola mais macia)");
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
