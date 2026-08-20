import { NextResponse } from 'next/server';

export interface SetupDiffItem {
  parameter: string;
  category: string; // Ex: 'Chassis', 'Front', 'Rear', 'Drivetrain', 'Tires Aero'
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

  // --- BARRAS ESTABILIZADORAS (ARB / Anti-Roll Bars) ---
  if (paramLower.includes('arb diameter')) {
    if (isFront) {
      return isIncrease
        ? `Diâmetro da barra dianteira maior (${oldValue} → ${newValue}): aumenta a rigidez rolável no eixo dianteiro, proporcionando resposta mais rápida ao esterçar, porém reduz o grip mecânico dianteiro induzindo subesterço (saída de frente).`
        : `Diâmetro da barra dianteira menor (${oldValue} → ${newValue}): reduz a rigidez e aumenta a aderência mecânica no eixo dianteiro, diminuindo o subesterço, mas com maior rolagem da carroceria.`;
    }
    if (isRear) {
      return isIncrease
        ? `Diâmetro da barra traseira maior (${oldValue} → ${newValue}): reduz a rolagem traseira e ajuda o carro a rotacionar nas curvas, porém aumenta a tendência de sobresterço (saída de traseira).`
        : `Diâmetro da barra traseira menor (${oldValue} → ${newValue}): proporciona mais tração mecânica na saída de curva e estabiliza a traseira, ao custo de maior tendência ao subesterço.`;
    }
  }

  if (paramLower.includes('arb position') || paramLower.includes('arb blade')) {
    if (isFront) {
      return `Ajuste da lâmina/posição da barra dianteira (${oldValue} → ${newValue}): altera a rigidez torcional efetiva da barra dianteira, modificando a transferência lateral de peso e o equilíbrio de entrada de curva.`;
    }
    if (isRear) {
      return `Ajuste da lâmina/posição da barra traseira (${oldValue} → ${newValue}): altera a rigidez torcional efetiva do eixo traseiro, impactando diretamente a rotação do carro no meio e na saída das curvas.`;
    }
  }

  // --- MOLAS, TORSION BARS E HEAVE/3RD SPRINGS ---
  if (paramLower.includes('heave spring rate') || paramLower.includes('3rd spring rate')) {
    if (isFront) {
      return isIncrease
        ? `Mola Heave/3ª mola dianteira mais rígida (${oldValue} → ${newValue}): controla com maior precisão o afundamento do chassi por carga aerodinâmica e frenagens, mantendo o divisor/splitter estável, mas perde absorção de impactos.`
        : `Mola Heave/3ª mola dianteira mais macia (${oldValue} → ${newValue}): melhora drasticamente o contato em zebras e oscilações no solo, mas permite maior variação do pitch aerodinâmico sob alta velocidade.`;
    }
    return isIncrease
      ? `3ª mola traseira mais rígida (${oldValue} → ${newValue}): sustenta o pitch traseiro sob alta carga aerodinâmica mantendo o difusor estável, porém reduz a complacência do eixo traseiro.`
      : `3ª mola traseira mais macia (${oldValue} → ${newValue}): oferece maior tração mecânica e absorção de ondulações na traseira, mas pode fazer a traseira afundar excessivamente em alta velocidade.`;
  }

  if (paramLower.includes('heave spring gap') || paramLower.includes('3rd spring gap') || paramLower.includes('bump rubber gap')) {
    return isIncrease
      ? `Aumento da folga do batente/gap da 3ª mola (${oldValue} → ${newValue}): o chassi viaja mais livremente antes de tocar a mola/batente, proporcionando transições mais suaves até o engate do suporte aerodinâmico.`
      : `Redução da folga do batente/gap da 3ª mola (${oldValue} → ${newValue}): atinge o suporte do batente/mola mais rápido sob compressão, estabilizando a plataforma aerodinâmica com menor curso de suspensão.`;
  }

  if (paramLower.includes('torsion bar') || paramLower.includes('spring rate') || paramLower.includes('corner spring')) {
    if (isFront) {
      return isIncrease
        ? `Barra de torção/mola dianteira mais rígida (${oldValue} → ${newValue}): eleva a sustentação do eixo dianteiro e agiliza a resposta de esterço, mas aumenta a tendência ao subesterço mecânico.`
        : `Barra de torção/mola dianteira mais macia (${oldValue} → ${newValue}): aumenta a aderência mecânica no eixo dianteiro e melhora a entrada de curva, porém aumenta a rolagem e a variação de altura.`;
    }
    if (isRear) {
      return isIncrease
        ? `Mola traseira mais rígida (${oldValue} → ${newValue}): melhora a resposta do carro em mudanças de direção rápidas, porém reduz a capacidade de tração mecânica ao acelerar.`
        : `Mola traseira mais macia (${oldValue} → ${newValue}): maximiza a tração de saída de curva e o contato do pneu no asfalto, mas diminui a precisão de esterço do carro.`;
    }
  }

  // --- ALTURA DO CHASSI, PUSHRODS E PESO POR RODA ---
  if (paramLower.includes('pushrod length')) {
    return isIncrease
      ? `Aumento do tamanho do Pushrod (${oldValue} → ${newValue}): eleva a altura de rodagem do canto correspondente, alterando o rake aerodinâmico e aumentando o curso de suspensão disponível.`
      : `Encurtamento do Pushrod (${oldValue} → ${newValue}): reduz a altura de rodagem do canto sem alterar a pré-carga da mola, rebaixando o centro de gravidade e mudando a carga aerodinâmica.`;
  }

  if (paramLower.includes('ride height') || paramLower.includes('splitter height')) {
    return isIncrease
      ? `Aumento na altura de rodagem (${oldValue} → ${newValue}): reduz o risco de bottoming-out (bater o assoalho no solo) e melhora a transição sobre zebras, com leve perda de eficiência aerodinâmica.`
      : `Redução na altura de rodagem (${oldValue} → ${newValue}): maximiza o efeito solo e o downforce ao aproximar o assoalho/splitter do asfalto, exigindo cuidado com o contato direto com a pista.`;
  }

  if (paramLower.includes('corner weight')) {
    return `Ajuste do peso por roda (${oldValue} → ${newValue}): modificação no balanceamento cruzado de peso (cross-weight), alinhando a distribuição estática do chassi para uniformizar o comportamento entre curvas à esquerda e à direita.`;
  }

  // --- FREIOS & SISTEMAS DO PILOTO ---
  if (paramLower.includes('brake pressure bias') || paramLower.includes('brake bias')) {
    return !isIncrease
      ? `Balanço de freio movido para a traseira (${oldValue} → ${newValue}): reduz o subesterço durante a entrada de curva com freio (trail-braking), mas aumenta o risco de travar as rodas traseiras e perder o controle.`
      : `Balanço de freio movido para a frente (${oldValue} → ${newValue}): proporciona frenagens mais estáveis em linha reta, mas pode travar as rodas dianteiras e causar subesterço na entrada de curva.`;
  }

  if (paramLower.includes('display page')) {
    return `Alteração da página do display (${oldValue} → ${newValue}): modifica a visualização primária do painel do volante pelo piloto para priorizar métricas específicas (ex: temperaturas de pneus, motor ou tempos de volta).`;
  }

  if (paramLower.includes('tc setting') || paramLower.includes('traction control')) {
    return !isIncrease
      ? `Redução na intervenção do Controle de Tração (${oldValue} → ${newValue}): entrega mais potência direta às rodas traseiras e melhora a velocidade de saída, exigindo maior precisão do piloto no pedal.`
      : `Aumento no Controle de Tração (${oldValue} → ${newValue}): previne o destracionamento e preserva a vida útil dos pneus traseiros, com pequenas perdas de aceleração na saída de curva.`;
  }

  // --- AMORTECEDORES (Dampers: Bump/Compression & Rebound) ---
  if (paramLower.includes('bump stiffness') || paramLower.includes('compression damping')) {
    if (paramLower.includes('high speed')) {
      return isIncrease
        ? `Aumento da compressão de alta velocidade (${oldValue} → ${newValue}): endurece a resposta a impactos rápidos como zebras e imperfeições do asfalto, sustentando a plataforma mas com perda de conformidade.`
        : `Redução da compressão de alta velocidade (${oldValue} → ${newValue}): melhora a capacidade da suspensão de absorver zebras e oscilações do asfalto sem desestabilizar o carro.`;
    }
    return isIncrease
      ? `Aumento da compressão de baixa velocidade (${oldValue} → ${newValue}): desacelera a velocidade com que o chassi se inclina nas entradas de curva e frenagens, tornando o carro mais arisco e rápido nas respostas.`
      : `Redução da compressão de baixa velocidade (${oldValue} → ${newValue}): permite uma transferência de peso mais suave ao frear e contornar curvas, aumentando o grip mecânico inicial.`;
  }

  if (paramLower.includes('rebound stiffness') || paramLower.includes('rebound damping')) {
    if (paramLower.includes('high speed')) {
      return isIncrease
        ? `Aumento do retorno de alta velocidade (${oldValue} → ${newValue}): segura a expansão rápida da mola após passar por uma zebra, prevenindo que o carro "salte", mas pode desacoplar o pneu em impactos em sequência.`
        : `Redução do retorno de alta velocidade (${oldValue} → ${newValue}): permite que a roda retorne mais rápido ao piso após subir em uma zebra, mantendo o contato contínuo do pneu.`;
    }
    return isIncrease
      ? `Aumento do retorno de baixa velocidade (${oldValue} → ${newValue}): estende o tempo que o chassi leva para voltar da rolagem/pitch, mantendo a estabilidade da plataforma em trocas rápidas de direção.`
      : `Redução do retorno de baixa velocidade (${oldValue} → ${newValue}): permite que o chassi recupere sua posição original mais rápido, tornando as reações da carroceria mais soltas.`;
  }

  // --- DRIVETRAIN E DIFERENCIAL ---
  if (paramLower.includes('diff preload')) {
    return isIncrease
      ? `Aumento do pré-carregamento do diferencial (${oldValue} → ${newValue}): eleva o bloqueio constante do diferencial, melhorando a tração e estabilidade sob aceleração e frenagem, mas gerando mais subesterço no meio da curva.`
      : `Redução do pré-carregamento do diferencial (${oldValue} → ${newValue}): deixa a rotação livre nas transições entre freio e acelerador, ajudando a apontar a frente do carro em curvas travadas.`;
  }

  if (paramLower.includes('clutch plates')) {
    return isIncrease
      ? `Aumento do número de discos de fricção (${oldValue} → ${newValue}): multiplica a força de bloqueio total do diferencial, aumentando a estabilidade e a tração sob aceleração ao custo de maior subesterço.`
      : `Redução do número de discos de fricção (${oldValue} → ${newValue}): reduz o atrito e a força máxima de bloqueio do diferencial, permitindo que o carro rotacione com mais facilidade na entrada e meio de curva.`;
  }

  if (paramLower.includes('coast angle')) {
    return !isIncrease
      ? `Redução do ângulo de Coast (${oldValue} → ${newValue}): aumenta o bloqueio do diferencial na desaceleração e entrada de curva, gerando maior estabilidade nas frenagens, mas podendo causar subesterço na entrada.`
      : `Aumento do ângulo de Coast (${oldValue} → ${newValue}): reduz o bloqueio do diferencial sem acelerador, ajudando o carro a soltar a traseira e virar com facilidade ao soltar o freio.`;
  }

  if (paramLower.includes('drive angle')) {
    return !isIncrease
      ? `Redução do ângulo de Drive (${oldValue} → ${newValue}): acelera a velocidade com que o diferencial bloqueia ao aplicar potência, maximizando a tração nas saídas de curva, porém exigindo cuidado com saídas bruscas de traseira.`
      : `Aumento do ângulo de Drive (${oldValue} → ${newValue}): torna o bloqueio de potência no diferencial mais progressivo e suave, reduzindo o subesterço de aceleração e facilitando a dosagem do pedal.`;
  }

  if (paramLower.includes('friction faces')) {
    return isIncrease
      ? `Aumento das superfícies de atrito no diferencial (${oldValue} → ${newValue}): intensifica o atrito mecânico do diferencial, aumentando o travamento geral do eixo sob carga.`
      : `Redução das superfícies de atrito (${oldValue} → ${newValue}): torna o comportamento do diferencial mais suave, facilitando o contorno de curvas de média velocidade.`;
  }

  // --- GEOMETRIA (Camber, Toe) ---
  if (paramLower.includes('camber')) {
    return isIncrease
      ? `Redução no ângulo negativo de cambagem (${oldValue} → ${newValue}): melhora a área de contato do pneu em retas, otimizando a frenagem e a tração, mas reduz o grip lateral máximo no meio da curva.`
      : `Aumento na cambagem negativa (${oldValue} → ${newValue}): otimiza a área de contato do pneu sob alta carga em apoio lateral, aumentando a velocidade de curva ao custo de menor tração em linha reta.`;
  }

  if (paramLower.includes('toe')) {
    return isIncrease
      ? `Ajuste na convergência/divergência (${oldValue} → ${newValue}): altera a prontidão e a agilidade da resposta inicial no volante, elevando levemente a temperatura do pneu em retas.`
      : `Ajuste do Toe próximo a zero (${oldValue} → ${newValue}): reduz o arrasto (drag) dos pneus nas retas e diminui a temperatura de rolagem, tornando a resposta de virada mais neutra.`;
  }

  // --- AERODINÂMICA E ASA (Aero Calculator, Wing, Flap, Gurney) ---
  if (paramLower.includes('wing angle') || paramLower.includes('rear wing')) {
    return !isIncrease
      ? `Redução do ângulo da asa traseira (${oldValue} → ${newValue}): diminui significativamente o arrasto aerodinâmico (drag), aumentando a velocidade final nas retas, com redução de pressão aerodinâmica na traseira em curvas de alta.`
      : `Aumento do ângulo da asa traseira (${oldValue} → ${newValue}): proporciona maior estabilidade e aderência em curvas de média e alta velocidade, gerando mais arrasto aerodinâmico em retas.`;
  }

  if (paramLower.includes('flap angle') || paramLower.includes('front aero')) {
    return isIncrease
      ? `Aumento do ângulo do flap dianteiro (${oldValue} → ${newValue}): incrementa o downforce no eixo dianteiro, melhorando o comportamento de curva em velocidade média/alta, mas aumentando o arrasto total.`
      : `Redução do ângulo do flap dianteiro (${oldValue} → ${newValue}): reduz o downforce dianteiro e o arrasto, ideal para balancear a perda de asa traseira e manter a estabilidade no halo de alta velocidade.`;
  }

  if (paramLower.includes('gurney flap') || paramLower.includes('gurney')) {
    return oldValue === 'None' || !isIncrease
      ? `Adição/Aumento do Gurney Flap (${oldValue} → ${newValue}): gera um pico substancial de downforce na traseira com baixo impacto no arrasto, colando o eixo traseiro em trechos de alta velocidade.`
      : `Remoção/Redução do Gurney Flap (${oldValue} → ${newValue}): reduz a pressão aerodinâmica traseira e limpa o fluxo de ar para alcançar maior velocidade final de reta.`;
  }

  if (paramLower.includes('downforce to drag')) {
    return `Eficiência aerodinâmica L/D (${oldValue} → ${newValue}): indica a proporção entre sustentação negativa (downforce) e arrasto (drag) gerada pelo pacote aerodinâmico atual.`;
  }

  if (paramLower.includes('front downforce')) {
    return `Balanço de Downforce Dianteiro (${oldValue} → ${newValue}): ajusta a porcentagem de carga aerodinâmica concentrada no eixo dianteiro, definindo o equilíbrio aerodinâmico em média/alta velocidade.`;
  }

  if (paramLower.includes('rh at speed')) {
    return `Altura dinamicamente simulada em velocidade (${oldValue} → ${newValue}): representa a folga em relação ao solo calculada sob carga aerodinâmica em reta para monitorar o correto fluxo sob o assoalho.`;
  }

  // --- PNEUS, PRESSÃO E TELEMETRIA (Cold/Hot Pressure, Temps, Tread) ---
  if (paramLower.includes('cold pressure')) {
    return !isIncrease
      ? `Redução da pressão inicial a frio (${oldValue} → ${newValue}): aumenta a deformação inicial da carcaça e a área de contato, gerando maior grip mecânico com aquecimento mais uniforme ao atingir a temperatura ideal.`
      : `Aumento da pressão inicial a frio (${oldValue} → ${newValue}): proporciona resposta de volante mais firme e reduz a temperatura máxima de trabalho da carcaça em trechos de alta demanda.`;
  }

  if (paramLower.includes('last hot pressure')) {
    return `Pressão a quente registrada (${oldValue} → ${newValue}): reflete a pressão atingida pelo pneu em temperatura de trabalho na pista, influenciando o perfil do pneu e a estabilidade das carcaças em stints longos.`;
  }

  if (paramLower.includes('last temps') || paramLower.includes('temps omi') || paramLower.includes('temps imo')) {
    return `Temperaturas operacionais dos pneus (Outer/Middle/Inner) (${oldValue} → ${newValue}): indicam a distribuição de calor através da banda de rodagem, essenciais para avaliar o alinhamento de cambagem e pressão a quente.`;
  }

  if (paramLower.includes('tread remaining')) {
    return `Desgaste e borracha remanescente (${oldValue} → ${newValue}): monitora o percentual de borracha restante na superfície do pneu ao final do stint.`;
  }

  if (paramLower.includes('fuel level')) {
    return `Carga de combustível (${oldValue} → ${newValue}): altera o peso total do veículo e o centro de massa longitudinal, afetando diretamente a frenagem e o desgaste de pneus ao longo do stint.`;
  }

  // --- FALLBACK GENÉRICO ---
  return `O parâmetro "${parameter}" foi alterado de ${oldValue} para ${newValue}. Essa modificação reajusta a distribuição de peso, equilíbrio dinâmico ou suporte aerodinâmico do chassi.`;
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
