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
 * Describes a "make it softer/harder" adjustment without inventing a numeric target.
 * Each car has its own discrete step table in iRacing (spring rates, ARB diameters etc. only
 * come in specific catalog values) that we don't have access to, so guessing an arithmetic
 * target (e.g. "170 * 0.9") could suggest a value that isn't even selectable in the game.
 * The one exception is damper clicks, where ±1 click is always how the in-game adjustment works.
 */
function concreteTarget(hit: ParamHit, softer: boolean): string {
  const parsed = parseValueUnit(hit.current);
  const softHard = softer ? "mais macio" : "mais rígido";
  if (!parsed) return `um passo ${softHard} a partir do valor atual (${hit.current})`;
  const { number, unit } = parsed;
  if (/clicks|click/i.test(unit)) {
    const target = softer ? number - 1 : number + 1;
    return `${hit.current} → ${target >= 0 ? "+" : ""}${target} clicks (${softer ? "1 clique mais macio" : "1 clique mais rígido"}; confirme se essa é a direção certa no texto de ajuda do próprio menu de setup, pois o sentido do clique varia por carro)`;
  }
  // Continuous-looking values (N/mm, mm, deg, %) only accept specific catalog steps per carro,
  // que não temos mapeados — em vez de chutar um número, aponta a direção e o valor atual.
  return `um passo ${softHard} que o atual (${hit.current}) — use a seta/dropdown do próprio jogo para o próximo valor disponível nessa direção, ele já respeita os limites do carro`;
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

    /** Builds a recommendation whose "direction" text always states a concrete, unambiguous target (not just "amoleça"). */
    const push = (adjustment: string, why: string, validate: string, pattern: RegExp, sectionPattern: RegExp | undefined, softer: boolean, fallbackDirection: string) => {
      const hits = hasDecoded ? findParams(decodedRows, pattern, sectionPattern) : [];
      const parameter = describeParams(hits);
      const direction = hits.length ? concreteTarget(hits[0], softer) : fallbackDirection;
      recommendations.push({ adjustment, direction, why, validate, parameter });
    };

    if (understeer && entry) {
      push("Brake bias", "Ajuda o carro a rotacionar na fase inicial sem pedir mais volante.", "Compare yaw rate, pico de volante e estabilidade da traseira na frenagem.", /brake.*bias|bias/i, undefined, true, "Teste 0,25–0,50 p.p. para trás (menos bias dianteiro)");
      push("Barra estabilizadora dianteira", "Aumenta aderência mecânica dianteira no turn-in e meio da curva.", "Confirme menor correção de volante sem piorar apoio em curva rápida.", /arb.*diameter|diameter.*arb/i, /front|diant/i, true, "Amoleça (reduza a rigidez) um passo");
    }
    if (understeer && !entry) {
      push("Barra estabilizadora dianteira", "Desloca equilíbrio lateral para permitir mais rotação no meio da curva.", "Procure maior aceleração lateral com o mesmo ângulo de volante.", /arb.*diameter|diameter.*arb/i, /front|diant/i, true, "Amoleça (reduza a rigidez) um passo");
      push("Diferencial em potência (power)", "Pode diminuir a tendência de abrir a trajetória durante a retomada.", "Compare throttle, yaw rate e wheelspin na saída.", /power/i, undefined, true, "Reduza o bloqueio em power um passo");
    }
    if (oversteer && entry) {
      push("Brake bias", "Reduz a rotação da traseira durante trail braking.", "Confirme estabilidade sem criar subesterço excessivo na entrada.", /brake.*bias|bias/i, undefined, false, "Teste 0,25–0,50 p.p. para frente (mais bias dianteiro)");
      push("Diferencial em coast", "Estabiliza o eixo traseiro na desaceleração.", "Observe yaw rate ao soltar o freio e velocidade mínima.", /coast/i, undefined, false, "Aumente o bloqueio em coast um passo");
    }
    if (oversteer && !entry) {
      push("Barra estabilizadora traseira", "Entrega mais aderência mecânica atrás e reduz sobresterço sustentado.", "Compare aceleração lateral, correções e temperatura dos pneus entre os dois lados.", /arb.*diameter|diameter.*arb/i, /rear|trase/i, true, "Amoleça (reduza a rigidez) um passo");
    }
    if (traction || (oversteer && exit)) {
      push("Mola traseira (ambos os lados)", "A prioridade é aumentar contato mecânico sem mascarar o problema com diferencial excessivo.", "Use throttle, LongAccel, Steering e diferença de rotação das rodas quando disponível; ajuste os dois lados juntos, não só um.", /spring.?rate/i, /^(left rear|right rear)$/i, true, "Reduza um passo (mola mais macia)");
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
