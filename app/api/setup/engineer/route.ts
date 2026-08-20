import { NextResponse } from 'next/server';

export interface SetupDiffItem {
  parameter: string;
  category: string; // Ex: 'Front', 'Rear', 'Left Front', 'Right Rear', 'Drivetrain', 'Aero', 'System'
  oldValue: string | number;
  newValue: string | number;
}

function parseNumericValue(val: string | number): number | null {
  if (typeof val === 'number') return val;
  const match = val.toString().match(/[-+]?[0-9]*\.?[0-9]+/);
  return match ? parseFloat(match[0]) : null;
}

export function generateSetupInsight(item: SetupDiffItem): string {
  const { parameter, category, oldValue, newValue } = item;
  const categoryLower = category.toLowerCase();
  const paramLower = parameter.toLowerCase();
  
  const numOld = parseNumericValue(oldValue);
  const numNew = parseNumericValue(newValue);
  const isIncrease = numOld !== null && numNew !== null ? numNew > numOld : false;

  const isFront = categoryLower.includes('front') || paramLower.includes('front');
  const isRear = categoryLower.includes('rear') || paramLower.includes('rear');

  // --- BARRAS ESTABILIZADORAS (ARB / Anti-Roll Bars & Blades) ---
  if (paramLower.includes('arb diameter') || paramLower.includes('arb size')) {
    if (isFront) {
      return isIncrease
        ? `Aumento no diâmetro da barra dianteira (${oldValue} → ${newValue}): reduz a rolagem do chassi na entrada de curva e melhora a precisão do volante, mas aumenta o subesterço mecânico.`
        : `Redução no diâmetro da barra dianteira (${oldValue} → ${newValue}): ganha aderência mecânica no eixo dianteiro e reduz o subesterço, mas deixa a resposta de esterço mais lenta.`;
    }
    if (isRear) {
      return isIncrease
        ? `Aumento no diâmetro da barra traseira (${oldValue} → ${newValue}): ajuda o carro a rotacionar melhor no meio/saída de curva, mas aumenta a tendência ao sobresterço.`
        : `Redução no diâmetro da barra traseira (${oldValue} → ${newValue}): melhora a tração sob aceleração e estabiliza a traseira, ao custo de maior subesterço em curvas médias.`;
    }
  }

  if (paramLower.includes('arb position') || paramLower.includes('arb blade') || paramLower.includes('arb setting')) {
    return `A alteração nas lâminas/posição da barra (${oldValue} → ${newValue}) redistribui a rigidez lateral de rolagem; melhora a precisão de resposta e a estabilidade dependendo do eixo ajustado.`;
  }

  // --- MOLAS, TORSION BARS E HEAVE / 3RD SPRINGS ---
  if (paramLower.includes('heave spring rate') || paramLower.includes('heave spring')) {
    if (isFront) {
      return isIncrease
        ? `3ª mola/Heave dianteira mais rígida (${oldValue} → ${newValue}): suporta a carga aerodinâmica em alta velocidade mantendo a plataforma e o splitter estáveis, mas perde absorção de zebras.`
        : `3ª mola/Heave dianteira mais macia (${oldValue} → ${newValue}): melhora o contato do pneu com o solo em ondulações, mas permite maior variação da altura dianteira em alta velocidade.`;
    }
    return isIncrease
      ? `3ª mola/Heave traseira mais rígida (${oldValue} → ${newValue}): evita o afundamento da traseira em alta velocidade estabilizando o difusor, mas reduz a complacência do eixo.`
      : `3ª mola/Heave traseira mais macia (${oldValue} → ${newValue}): melhora a absorção mecânica e tração na traseira, mas permite variação de rake sob carga aerodinâmica.`;
  }

  if (paramLower.includes('heave perch offset')) {
    return `Ajuste no Heave Perch Offset (${oldValue} → ${newValue}): altera a pré-carga e a altura estática do elemento central de suspensão, ajustando a plataforma aerodinâmica sob carga longitudinal.`;
  }

  if (paramLower.includes('heave slider defl') || paramLower.includes('heave spring defl')) {
    return `Alteração no curso/deformação da mola Heave (${oldValue} → ${newValue}): impacta diretamente a margem de compressão em alta velocidade e a absorção de zebras/ondulações.`;
  }

  if (paramLower.includes('torsion bar od') || paramLower.includes('torsion bar defl') || paramLower.includes('torsion bar turns')) {
    if (isFront) {
      return isIncrease
        ? `Aumento de rigidez/diâmetro na barra de torção dianteira (${oldValue} → ${newValue}): acelera a resposta de esterço e sustenta o chassi na frenagem, mas pode gerar subesterço mecânico.`
        : `Redução de rigidez/diâmetro na barra de torção dianteira (${oldValue} → ${newValue}): ganha aderência mecânica na entrada de curva e melhora o contorno em pistas ondulas.`;
    }
    return isIncrease
      ? `Aumento de rigidez na barra de torção traseira (${oldValue} → ${newValue}): torna a rotação do carro mais rápida, com o compromisso de perder estabilidade na aceleração.`
      : `Redução de rigidez na barra de torção traseira (${oldValue} → ${newValue}): maximiza a tração mecânica nas saídas de curva e suaviza reações sobre zebras.`;
  }

  // --- ALTURA, PUSHRODS E GEOMETRIA ---
  if (paramLower.includes('pushrod length')) {
    return isIncrease
      ? `Aumento no Pushrod (${oldValue} → ${newValue}): eleva a altura de rodagem no canto, alterando o rake aerodinâmico e aumentando o curso de suspensão.`
      : `Encurtamento do Pushrod (${oldValue} → ${newValue}): reduz a altura estática do canto, abaixando o centro de gravidade e aumentando o efeito solo.`;
  }

  if (paramLower.includes('ride height')) {
    return isIncrease
      ? `Aumento da altura de rodagem (${oldValue} → ${newValue}): reduz o risco de tocar o assoalho no solo (bottoming) e melhora a absorção de zebras, reduzindo levemente o downforce.`
      : `Redução da altura de rodagem (${oldValue} → ${newValue}): aproxima o assoalho da pista, aumentando a eficiência do efeito solo e o downforce geral.`;
  }

  if (paramLower.includes('corner weight')) {
    return `Ajuste de peso por roda (${oldValue} → ${newValue}): altera a distribuição cruzada de massa (cross-weight), alinhando o equilíbrio em curvas para a esquerda e direita.`;
  }

  if (paramLower.includes('camber')) {
    return isIncrease
      ? `Redução na cambagem negativa (${oldValue} → ${newValue}): otimiza a área de contato em linha reta beneficiando frenagens e acelerações, com leve perda de sustentação em curvas rápidas.`
      : `Aumento na cambagem negativa (${oldValue} → ${newValue}): maximiza a aderência lateral sob apoio máximo em curvas, exigindo cuidado com a temperatura do ombro interno do pneu.`;
  }

  if (paramLower.includes('toe')) {
    return isIncrease
      ? `Ajuste no Toe (${oldValue} → ${newValue}): modifica a velocidade de resposta no início do esterço e a estabilidade em retas, aumentando o atrito e aquecimento das superfícies.`
      : `Ajuste de Toe para neutro/menos divergente (${oldValue} → ${newValue}): melhora a velocidade de reta e reduz o desgaste/aquecimento dos pneus.`;
  }

  // --- AMORTECEDORES (Dampers, Slopes & Deflections) ---
  if (paramLower.includes('hs comp damp slope')) {
    return `Ajuste na inclinação de compressão de alta velocidade (${oldValue} → ${newValue}): altera a transição na rigidez do amortecedor ao impactar zebras e ondulações severas.`;
  }

  if (paramLower.includes('hs comp') || paramLower.includes('hs rbd') || paramLower.includes('ls comp') || paramLower.includes('ls rbd') || paramLower.includes('shock defl')) {
    return `Alteração no amortecimento (${oldValue} → ${newValue}): ajusta o controle de pitch e roll do chassi, modificando a velocidade de transferência de carga em frenagens, trocas de direção e retomadas.`;
  }

  // --- FREIOS & CONTROLES ELETRÔNICOS ---
  if (paramLower.includes('bias migration gain')) {
    return `Ajuste do ganho da migração de freio (${oldValue} → ${newValue}): altera quão dinamicamente o balanço de freio se desloca em função do pedal ou pressão aplicada.`;
  }

  if (paramLower.includes('bias migration')) {
    return `Ajuste na migração do freio (${oldValue} → ${newValue}): rebalanceia a variação da distribuição de frenagem ao longo da desaceleração, prevenindo o travamento prematuro do eixo traseiro.`;
  }

  if (paramLower.includes('brake pressure bias') || paramLower.includes('brake bias')) {
    return !isIncrease
      ? `Balanço de freio movido para a traseira (${oldValue} → ${newValue}): ajuda a rotacionar o carro no trail-braking, aumentando a exigência sobre os pneus traseiros.`
      : `Balanço de freio movido para a frente (${oldValue} → ${newValue}): garante frenagens mais estáveis em linha reta, com maior tendência a subesterço na entrada de curva.`;
  }

  if (paramLower.includes('pad compound')) {
    return `Mudança na pasta de freio (${oldValue} → ${newValue}): altera a resposta inicial da mordida (bite), a modulação do pedal e o perfil de desgaste/temperatura do sistema de freio.`;
  }

  if (paramLower.includes('master cyl')) {
    return isIncrease
      ? `Aumento no cilindro mestre (${oldValue} → ${newValue}): deixa o pedal de freio mais firme com menor curso, exigindo maior força do piloto para a mesma pressão.`
      : `Redução no cilindro mestre (${oldValue} → ${newValue}): aumenta a multiplicação hidráulica, deixando o pedal mais macio e fácil de dosar.`;
  }

  if (paramLower.includes('traction control slip') || paramLower.includes('tc1')) {
    return !isIncrease
      ? `Redução no Slip do Controle de Tração (${oldValue} → ${newValue}): o sistema intervém mais cedo ao detectar derrapagem, garantindo estabilidade mas podendo cortar aceleração.`
      : `Aumento no Slip do Controle de Tração (${oldValue} → ${newValue}): permite maior deslizamento dos pneus traseiros antes da intervenção do motor, maximizando a aceleração.`;
  }

  if (paramLower.includes('traction control gain') || paramLower.includes('tc2')) {
    return !isIncrease
      ? `Redução no Ganho do TC (${oldValue} → ${newValue}): suaviza o corte de potência do motor quando a tração se perde, tornando a recuperação do carro mais progressiva.`
      : `Aumento no Ganho do TC (${oldValue} → ${newValue}): aplica cortes de torque mais agressivos ao detectar patinagem, prevenindo rodadas repentinas.`;
  }

  // --- DRIVETRAIN & DIFERENCIAL ---
  if (paramLower.includes('clutch friction plates')) {
    return isIncrease
      ? `Aumento no número de discos de fricção (${oldValue} → ${newValue}): incrementa a capacidade total de bloqueio mecânico do diferencial, aumentando a tração em retas.`
      : `Redução no número de discos de fricção (${oldValue} → ${newValue}): reduz o travamento do diferencial, liberando a rotação em curvas e prevenindo o subesterço de potência.`;
  }

  if (paramLower.includes('coast drive ramp options') || paramLower.includes('ramp')) {
    return `Alteração nas rampas do diferencial (${oldValue} → ${newValue}): reconfigura o comportamento mecânico de travamento de acordo com a aceleração ou retenção de motor.`;
  }

  if (paramLower.includes('preload')) {
    return isIncrease
      ? `Aumento da pré-carga do diferencial (${oldValue} → ${newValue}): eleva o travamento contínuo, melhorando a tração e a estabilidade nas frenagens ao custo de subesterço no meio de curva.`
      : `Redução da pré-carga do diferencial (${oldValue} → ${newValue}): permite maior liberdade de rotação entre as rodas traseiras na fase de transição de curva.`;
  }

  // --- AERODINÂMICA & COMBUSTÍVEL ---
  if (paramLower.includes('downforce balance') || paramLower.includes('front downforce')) {
    return isIncrease
      ? `Aumento na porcentagem de Downforce dianteiro (${oldValue} → ${newValue}): desloca o centro de pressão aerodinâmica para a frente, melhorando o contorno em alta velocidade.`
      : `Redução na porcentagem de Downforce dianteiro (${oldValue} → ${newValue}): estabiliza o eixo traseiro em trechos de alta velocidade, reduzindo a tendência de sobresterço aerodinâmico.`;
  }

  if (paramLower.includes('l/d') || paramLower.includes('ld')) {
    return `Eficiência Aerodinâmica L/D (${oldValue} → ${newValue}): representa a proporção de sustentação negativa gerada para cada unidade de arrasto produzido.`;
  }

  if (paramLower.includes('rear wing angle') || paramLower.includes('wing angle')) {
    return !isIncrease
      ? `Redução no ângulo da asa traseira (${oldValue} → ${newValue}): diminui o arrasto aerodinâmico aumentando a velocidade final nas retas, com menor apoio em curvas rápidas.`
      : `Aumento no ângulo da asa traseira (${oldValue} → ${newValue}): aumenta a sustentação negativa na traseira, garantindo maior aderência em curvas médias/rápidas.`;
  }

  if (paramLower.includes('fuel level') || paramLower.includes('fuel target') || paramLower.includes('fuel low warning')) {
    return `Ajuste do sistema de combustível (${oldValue} → ${newValue}): altera a massa total do veículo, deslocando o centro de gravidade e o tempo de volta estimado.`;
  }

  // --- PNEUS, PRESSÃO E TELEMETRIA ---
  if (paramLower.includes('last hot pressure')) {
    return `Pressão de trabalho a quente (${oldValue} → ${newValue}): indica o ganho de pressão hidráulica do ar/nitrogênio interno após o aquecimento em pista.`;
  }

  if (paramLower.includes('last temps') || paramLower.includes('tread remaining')) {
    return `Métrica de leitura de pneu (${oldValue} → ${newValue}): exibe a janela térmica de operação ou o percentual de desgaste da borracha ao final do stint.`;
  }

  // --- FALLBACK GENÉRICO ---
  return `O parâmetro "${parameter}" foi alterado de ${oldValue} para ${newValue}. Reajusta o equilíbrio dinâmico ou a plataforma do chassi; valide o impacto em telemetria.`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { diffs } = body;

    if (!Array.isArray(diffs)) {
      return NextResponse.json({ error: 'Formato inválido. Esperado um array "diffs".' }, { status: 400 });
    }

    const processedDiffs = diffs.map((item: SetupDiffItem) => ({
      ...item,
      insight: generateSetupInsight(item)
    }));

    return NextResponse.json({ insights: processedDiffs });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao processar os insights de setup.' }, { status: 500 });
  }
}
