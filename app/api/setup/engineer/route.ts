import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DecodedRow, comparativeSummary, diffSetups } from "@/lib/setup-diff";

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
function concreteTarget(hit: ParamHit, raise: boolean | null, note = ""): string {
  const parsed = parseValueUnit(hit.current);
  if (raise === null) return `valor atual ${hit.current} — a direção certa depende do tipo de diferencial deste carro; teste um passo em cada sentido no menu e compare qual reduz o problema`;
  const verb = raise ? "Aumente" : "Diminua";
  if (!parsed) return `${verb} o valor a partir do atual (${hit.current}) no menu do carro${note}`;
  const { number, unit } = parsed;
  if (/clicks|click/i.test(unit)) {
    const target = raise ? number + 1 : number - 1;
    return `${hit.current} → ${target >= 0 ? "+" : ""}${target} clicks (1 clique ${raise ? "a mais" : "a menos"})`;
  }
  // Continuous-looking values (N/mm, mm, deg, %) só aceitam degraus específicos do catálogo do
  // carro, que não temos mapeados — por isso apontamos a direção sem inventar o número exato.
  return `${verb} o valor a partir do atual (${hit.current}) — use a seta/dropdown do próprio jogo para o próximo valor disponível nessa direção, ele já respeita os limites do carro${note}`;
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

/**
 * Anti-roll bar stiffness, aware of the two naming/unit conventions iRacing actually uses
 * (confirmed against the official Super Formula SF23 and McLaren 720S GT3 EVO manuals):
 *  - "ARB Diameter" (mm) — larger diameter = stiffer. Only a handful of discrete sizes exist
 *    per car (e.g. SF23 front is 15/18/30mm only), never a continuous range.
 *  - "ARB Blades" (numbered) — higher number = stiffer, per the GT3 manual.
 * Both conventions agree that a higher on-screen number means stiffer, so `raise` maps directly.
 */
function arbTarget(rows: DecodedRow[], axlePattern: RegExp, wantStiffer: boolean) {
  // "ARB Diameter" (SF23/GT3) and "ARB Size" (GTP — Acura/BMW/Porsche/Cadillac manuals all use this
  // exact wording, confirmed byte-identical across all four, so it's a class-wide spec convention)
  // both mean the same thing: bigger number = stiffer, only a few fixed options, never continuous.
  const diameterHits = findParams(rows, /arb.*(diameter|size)|(diameter|size).*arb/i, axlePattern);
  if (diameterHits.length) return { parameter: describeParams(diameterHits), direction: concreteTarget(diameterHits[0], wantStiffer, " (esse carro só aceita algumas opções fixas de diâmetro/tamanho — não é um valor contínuo)") };
  const bladeHits = findParams(rows, /arb.*blades?/i, axlePattern);
  if (bladeHits.length) return { parameter: describeParams(bladeHits), direction: concreteTarget(bladeHits[0], wantStiffer) };
  return { parameter: null, direction: null };
}

type DiffGoal = "more-lock-entry" | "less-lock-exit";

/**
 * Differential lock, aware of the three architectures we have official documentation for:
 *  - SF23-style: independent "Coast Angle" (braking/lift-off) and "Drive Angle" (throttle).
 *    Per the manual, HIGHER angle = LESS force = more oversteer; LOWER angle = MORE force =
 *    more understeer/stability. This is the opposite of a naive "higher number = more lock".
 *  - GT3-style: a single "Diff Preload" (ft-lbs). Per the manual, increasing preload adds
 *    understeer off-throttle (more stable entry) AND more snap oversteer on throttle — it's
 *    one dial with a trade-off in both directions, not two independent adjustments.
 *  - GTP-style (Acura ARX-06, BMW M Hybrid V8, Porsche 963, Cadillac V-Series.R — confirmed via
 *    all four official manuals, whose "Systems"/differential pages are byte-identical, so this is a
 *    class-wide LMDh spec convention, not a one-off): "Diff Ramp Angles" behave like SF23's
 *    coast/drive angle (lower angle = more locking force, inverted from a naive reading) but the
 *    manual describes them affecting both braking AND acceleration phases together rather than two
 *    independent dials, plus a separate "Preload" (direct: more = more lock, same as GT3) and
 *    "Clutch Friction Plates" (a plate-count multiplier — more plates = more lock in ALL
 *    conditions, always). The Ferrari 499P has no published manual yet, but it races in the same
 *    GTP class under the same converged regs — this GTP branch is applied to it too on that basis,
 *    which we say explicitly rather than pretend it's confirmed for that specific car.
 */
function differentialTarget(rows: DecodedRow[], goal: DiffGoal) {
  if (goal === "more-lock-entry") {
    const coastHits = findParams(rows, /coast.*angle/i);
    if (coastHits.length) return { parameter: describeParams(coastHits), direction: concreteTarget(coastHits[0], false), tradeoff: "" };
    const rampHits = findParams(rows, /ramp.*angle/i);
    if (rampHits.length) return { parameter: describeParams(rampHits), direction: concreteTarget(rampHits[0], false), tradeoff: " Atenção: nesse carro (arquitetura GTP) o ramp angle afeta frenagem E aceleração juntos, não só a entrada — pode aumentar o sobresterço na saída também." };
    const preloadHits = findParams(rows, /diff.*preload|^preload$/i);
    if (preloadHits.length) return { parameter: describeParams(preloadHits), direction: concreteTarget(preloadHits[0], true), tradeoff: " Atenção: nesse carro o preload é um dial só — aumentar também deixa a saída mais propensa a sobresterço de \"snap\" se você acelerar de forma agressiva." };
    const plateHits = findParams(rows, /clutch.*(plate|face)/i);
    if (plateHits.length) return { parameter: describeParams(plateHits), direction: concreteTarget(plateHits[0], true), tradeoff: " Isso é um multiplicador de bloqueio que vale para toda a volta (entrada e saída), não só para a frenagem — mude só um passo e compare os dois trechos." };
    return { parameter: null, direction: "valor atual — a direção certa depende do tipo de diferencial deste carro; teste um passo em cada sentido no menu e compare qual reduz o problema", tradeoff: "" };
  }
  const driveHits = findParams(rows, /drive.*angle/i);
  if (driveHits.length) return { parameter: describeParams(driveHits), direction: concreteTarget(driveHits[0], true), tradeoff: "" };
  const rampHits = findParams(rows, /ramp.*angle/i);
  if (rampHits.length) return { parameter: describeParams(rampHits), direction: concreteTarget(rampHits[0], true), tradeoff: " Atenção: nesse carro (arquitetura GTP) o ramp angle afeta frenagem E aceleração juntos, não só a saída — pode deixar a entrada mais instável também." };
  const preloadHits = findParams(rows, /diff.*preload|^preload$/i);
  if (preloadHits.length) return { parameter: describeParams(preloadHits), direction: concreteTarget(preloadHits[0], false), tradeoff: " Atenção: nesse carro o preload é um dial só — reduzir também deixa a entrada/desaceleração menos estável (mais sobresterço fora do acelerador)." };
  const plateHits = findParams(rows, /clutch.*(plate|face)/i);
  if (plateHits.length) return { parameter: describeParams(plateHits), direction: concreteTarget(plateHits[0], false), tradeoff: " Isso é um multiplicador de bloqueio que vale para toda a volta (entrada e saída), não só para a saída — mude só um passo e compare os dois trechos." };
  return { parameter: null, direction: "valor atual — a direção certa depende do tipo de diferencial deste carro; teste um passo em cada sentido no menu e compare qual reduz o problema", tradeoff: "" };
}

/**
 * Rear spring stiffness, aware of two different suspension architectures:
 *  - Conventional (SF23, GT3): a per-corner "Spring Rate" you set independently for Left Rear and
 *    Right Rear.
 *  - GTP/LMDh (Acura, BMW, Porsche, Cadillac — same class-wide spec confirmed across all four
 *    manuals): a single central "Heave Spring" instead, decoupled from roll stiffness by design
 *    (that's what a heave/roll damper layout is for). There's no separate Left/Right Rear spring to
 *    adjust. The manual is explicit that softening it isn't free: "you will lose some amount of
 *    downforce and efficiency mid corner as the rear ride heights will be well under the target
 *    rear heights for maximum downforce" — so we surface that trade-off instead of treating it like
 *    an ordinary spring change.
 */
function springTarget(rows: DecodedRow[], axlePattern: RegExp, wantStiffer: boolean) {
  const cornerHits = findParams(rows, /spring.?rate/i, axlePattern);
  if (cornerHits.length) return { parameter: describeParams(cornerHits), direction: concreteTarget(cornerHits[0], wantStiffer), tradeoff: "" };
  const heaveHits = findParams(rows, /heave.*spring/i, /rear/i);
  if (heaveHits.length) return { parameter: describeParams(heaveHits), direction: concreteTarget(heaveHits[0], wantStiffer), tradeoff: " Atenção: nesse carro (arquitetura GTP) não existe mola separada por roda — isso é a Heave Spring central, e amolecer ela também reduz downforce/eficiência no meio da curva porque a altura traseira cai abaixo do ideal aerodinâmico. Se notar perda de carga em curva rápida depois desse ajuste, considere endurecer a barra estabilizadora traseira em vez de amolecer ainda mais a heave spring." };
  return { parameter: null, direction: null, tradeoff: "" };
}

async function blendSetups(driverId: string, setupIdA: string, setupIdB: string, carId: number, trackId: number, feedback: string) {
  const { data, error } = await supabaseAdmin.from("setup_files").select("id,filename,decoded_params").eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).in("id", [setupIdA, setupIdB]);
  if (error || !data || data.length !== 2) throw new Error("Um dos setups mencionados não foi encontrado neste carro/pista");
  const a = data.find((row) => row.id === setupIdA)!, b = data.find((row) => row.id === setupIdB)!;
  const rowsA: DecodedRow[] = Array.isArray(a.decoded_params) ? (a.decoded_params as DecodedRow[]) : [];
  const rowsB: DecodedRow[] = Array.isArray(b.decoded_params) ? (b.decoded_params as DecodedRow[]) : [];
  if (!rowsA.length || !rowsB.length) throw new Error(`${!rowsA.length ? a.filename : b.filename} ainda não tem parâmetros decodificados pelo Garage61`);

  const changes = diffSetups(rowsA, rowsB).filter((change) => change.actionable);
  const recommendations = changes.map((change) => ({
    adjustment: `${change.tab} • ${change.section} • ${change.label}`,
    direction: `${a.filename}: ${change.before}  ×  ${b.filename}: ${change.after} — teste um valor no menu entre os dois; comece mais perto do lado cuja característica você quer priorizar aqui`,
    why: change.explanation,
    validate: "Compare telemetria (freio, rotação e tração) contra as duas voltas de referência para ver se ficou de fato no meio-termo.",
    parameter: null,
  }));

  // Síntese do balanço geral (ex.: "um setup pende mais pra dianteira, o outro mais pra traseira")
  // por categoria, antes de listar parâmetro a parâmetro — isso é o "meio-termo conceitual" que
  // explica ONDE cada setup pende, para o piloto decidir para qual lado ir em cada trecho.
  const balanceNarrative = comparativeSummary(changes, "Setup A", "Setup B");

  return {
    status: "ok" as const,
    setup: { id: a.id, filename: `${a.filename} × ${b.filename} (meio-termo)` },
    summary: `${balanceNarrative}${feedback ? ` Sobre o que você pediu ("${feedback.replace(/\[\[([^\]]+)\]\]/g, "$1")}"): use isso para decidir, categoria a categoria, para qual lado pender — os valores exatos de cada parâmetro estão detalhados abaixo.` : ""}`,
    recommendations,
    hasDecodedParameters: true,
    limitation: "Isso é uma comparação estrutural entre os dois setups, não uma mistura calculada automaticamente — o valor exato do meio-termo precisa ser escolhido por você no menu do carro, porque cada carro só aceita certos valores fixos (não é um intervalo contínuo).",
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { setupId?: string; blendWithSetupId?: string; carId?: number; trackId?: number; feedback?: string };
    if (!body.setupId || !Number.isInteger(body.carId) || !Number.isInteger(body.trackId)) throw new Error("Selecione um setup, carro e pista");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    if (body.blendWithSetupId && body.blendWithSetupId !== body.setupId) {
      const result = await blendSetups(driver.id, body.setupId, body.blendWithSetupId, body.carId as number, body.trackId as number, body.feedback?.trim() ?? "");
      return NextResponse.json(result);
    }

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
    const alreadyTooLow = /muito baixo|baixo demais|deixou.*baixo|raspa|raspando|bateu no chao|no fundo|bottoming|toca o chao|encostou no chao/.test(feedback);
    const springAlreadySofter = /diminui.*spring|reduzi.*spring|amoleci.*mola|diminui.*mola|reduzi.*mola|mola.*mais macia/.test(feedback);
    const recommendations: Recommendation[] = [];

    /** Builds a recommendation whose "direction" text always says explicitly to raise or lower the on-screen value. */
    const push = (adjustment: string, why: string, validate: string, pattern: RegExp, sectionPattern: RegExp | undefined, raise: boolean | null, fallbackDirection: string) => {
      const hits = hasDecoded ? findParams(decodedRows, pattern, sectionPattern) : [];
      const parameter = describeParams(hits);
      const direction = hits.length ? concreteTarget(hits[0], raise) : fallbackDirection;
      recommendations.push({ adjustment, direction, why, validate, parameter });
    };

    const pushArb = (adjustment: string, why: string, validate: string, axlePattern: RegExp, wantStiffer: boolean, fallbackDirection: string) => {
      const result = hasDecoded ? arbTarget(decodedRows, axlePattern, wantStiffer) : { parameter: null, direction: null };
      recommendations.push({ adjustment, direction: result.direction ?? fallbackDirection, why, validate, parameter: result.parameter });
    };

    const pushDiff = (adjustment: string, why: string, validate: string, goal: DiffGoal, fallbackDirection: string) => {
      const result = hasDecoded ? differentialTarget(decodedRows, goal) : { parameter: null, direction: null, tradeoff: "" };
      recommendations.push({ adjustment, direction: result.direction ?? fallbackDirection, why: `${why}${result.tradeoff ?? ""}`, validate, parameter: result.parameter });
    };

    const pushSpring = (adjustment: string, why: string, validate: string, axlePattern: RegExp, wantStiffer: boolean, fallbackDirection: string) => {
      const result = hasDecoded ? springTarget(decodedRows, axlePattern, wantStiffer) : { parameter: null, direction: null, tradeoff: "" };
      recommendations.push({ adjustment, direction: result.direction ?? fallbackDirection, why: `${why}${result.tradeoff ?? ""}`, validate, parameter: result.parameter });
    };

    if (understeer && entry) {
      push("Brake bias", "Ajuda o carro a rotacionar na fase inicial sem pedir mais volante.", "Compare yaw rate, pico de volante e estabilidade da traseira na frenagem.", /brake.*bias|bias/i, undefined, false, "Diminua 0,25–0,50 p.p. (menos bias dianteiro)");
      pushArb("Barra estabilizadora dianteira", "Aumenta aderência mecânica dianteira no turn-in e meio da curva.", "Confirme menor correção de volante sem piorar apoio em curva rápida.", /front|diant/i, false, "Diminua (barra mais fina/macia)");
    }
    if (understeer && !entry) {
      pushArb("Barra estabilizadora dianteira", "Desloca equilíbrio lateral para permitir mais rotação no meio da curva.", "Procure maior aceleração lateral com o mesmo ângulo de volante.", /front|diant/i, false, "Diminua (barra mais fina/macia)");
      pushDiff("Diferencial (lado saída/potência)", "Pode diminuir a tendência de abrir a trajetória durante a retomada.", "Compare throttle, yaw rate e wheelspin na saída.", "less-lock-exit", "Reduza o bloqueio um passo (confirme o sentido no menu do carro)");
    }
    if (oversteer && entry) {
      push("Brake bias", "Reduz a rotação da traseira durante trail braking.", "Confirme estabilidade sem criar subesterço excessivo na entrada.", /brake.*bias|bias/i, undefined, true, "Aumente 0,25–0,50 p.p. (mais bias dianteiro)");
      pushDiff("Diferencial (lado entrada/desaceleração)", "Estabiliza o eixo traseiro na desaceleração.", "Observe yaw rate ao soltar o freio e velocidade mínima.", "more-lock-entry", "Aumente o bloqueio um passo (confirme o sentido no menu do carro)");
    }
    if (oversteer && !entry) {
      pushArb("Barra estabilizadora traseira", "Entrega mais aderência mecânica atrás e reduz sobresterço sustentado.", "Compare aceleração lateral, correções e temperatura dos pneus entre os dois lados.", /rear|trase/i, false, "Diminua (barra mais fina/macia)");
    }
    if ((traction || (oversteer && exit)) && (alreadyTooLow || springAlreadySofter)) {
      // O piloto já relatou que amolecer a mola traseira deixou o carro baixo demais — não repetir a mesma sugestão.
      push("Altura traseira", "Você já relatou que a mola mais macia deixou o carro baixo demais; suba a altura para recuperar folga sem endurecer a mola de volta.", "Confira se ainda bate no chão nas zebras/ondulações mais fortes da pista antes de levar pra corrida.", /ride.?height/i, /^(left rear|right rear)$/i, true, "Aumente um passo");
      pushArb("Barra estabilizadora traseira", "Como a mola já está mais macia, use a barra para controlar a tração/rotação na saída sem depender de baixar o carro de novo.", "Compare aceleração lateral e patinagem de uma roda na saída antes e depois do ajuste.", /rear|trase/i, false, "Diminua (barra mais fina/macia)");
    } else if (traction || (oversteer && exit)) {
      pushSpring("Mola/Heave Spring traseira", "A prioridade é aumentar contato mecânico sem mascarar o problema com diferencial excessivo.", "Use throttle, LongAccel, Steering e diferença de rotação das rodas quando disponível; se o carro tiver mola por roda, ajuste os dois lados juntos, não só um. Se isso já deixou o carro baixo demais em algum teste anterior, compense subindo a altura em vez de amolecer mais.", /rear|trase/i, false, "Diminua (mola/heave spring mais macia)");
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
        ? "O formato binário .sto ainda não é regravado pelo servidor. Aplique um ajuste por vez no iRacing e valide na telemetria antes de consolidar. As direções de barra/diferencial/mola acima usam os manuais oficiais do Super Formula SF23, McLaren 720S GT3 EVO e dos GTP (Acura ARX-06, BMW M Hybrid V8, Porsche 963, Cadillac V-Series.R — as quatro têm o texto de diferencial/ARB/heave spring idêntico entre si, então tratamos como convenção da classe). O Ferrari 499P não tem manual oficial publicado ainda; para ele, aplicamos essa mesma lógica de GTP por analogia (mesma classe, mesmas convenções de nomenclatura), não por confirmação específica do carro. LMP2 (Dallara P217) segue sem essa confirmação."
        : "Este setup ainda não tem parâmetros decodificados (só chega via Garage61), então as sugestões abaixo são genéricas — não apontam o valor exato do seu setup. Use um setup já usado em corrida para recomendações com o parâmetro e valor atual citados.",
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
