export type DecodedRow = { tab?: string; section?: string; label?: string; metric_value?: string | number; is_mapped?: boolean };
export type ParsedChange = { tab: string; section: string; label: string; before: string; after: string; explanation: string; category: string; actionable: boolean; numericDelta: number | null };

export function numericOf(value: string) {
  return Number(value.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]);
}

export function categoryOf(label: string, section: string) {
  const key = `${label} ${section}`.toLowerCase();
  if (/display|dash|page|shift light|led|alert/.test(key)) return "display";
  if (/wing|asa|aero|gurney|flap/.test(key)) return "aero";
  if (/brake bias|balance|freio/.test(key)) return "brakes";
  if (/anti.?roll|arb|barra/.test(key)) return "arb";
  if (/spring|mola/.test(key)) return "springs";
  if (/ride height|altura/.test(key)) return "ride_height";
  if (/camber|cambagem|toe|converg|steering|direção|ackerman/.test(key)) return "alignment";
  if (/damp|shock|bump|rebound|amort/.test(key)) return "dampers";
  if (/differential|diff|preload|coast|power/.test(key)) return "differential";
  if (/pressure|pressao/.test(key)) return "tires";
  if (/gear|ratio|marcha/.test(key)) return "gearing";
  return "other";
}

export function effect(label: string, before: string, after: string, section?: string, tab?: string): { text: string; actionable: boolean } {
  const key = label.toLowerCase();
  const sectionKey = (section ?? "").toLowerCase();
  const from = numericOf(before), to = numericOf(after), increased = Number.isFinite(from) && Number.isFinite(to) ? to > from : null;
  const isFront = /front|diant/.test(sectionKey) || /front|diant/.test(key);
  const isRear = /rear|trase/.test(sectionKey) || /rear|trase/.test(key);
  const axleLabel = isFront ? "dianteir" : isRear ? "traseir" : null;

  if (/display|dash|page|shift light|led|alert/.test(key)) return { text: `Ajuste de exibição no painel/dash (${before} → ${after}); não altera o comportamento físico do carro, só a informação mostrada ao piloto.`, actionable: false };

  if (/rear.*wing|wing.*angle|asa.*trase|gurney/.test(key)) return { text: increased === null ? `A asa traseira ${before} → ${after} muda apoio e arrasto.` : increased ? `Mais asa traseira (${before} → ${after}) prende mais a traseira em curvas rápidas e na tração, mas aumenta o arrasto e reduz a velocidade de reta.` : `Menos asa traseira (${before} → ${after}) reduz o arrasto e aumenta a velocidade de reta, mas deixa a traseira mais solta e reduz a margem em curvas rápidas.`, actionable: true };
  if (/front.*wing|flap.*angle|asa.*diante/.test(key)) return { text: increased ? `Mais asa dianteira (${before} → ${after}) aumenta resposta e aderência da frente em média/alta velocidade, mas pode deixar a traseira relativamente mais solta e elevar o arrasto.` : `Menos asa dianteira (${before} → ${after}) acalma a entrada, desloca o balanço para subesterço e normalmente reduz o arrasto.`, actionable: true };
  if (/wing|asa|aero/.test(key)) return { text: `A mudança aerodinâmica ${before} → ${after} altera carga, balanço e arrasto; confira velocidade de reta e estabilidade em curva rápida.`, actionable: true };
  if (/brake bias|balance|freio/.test(key)) return { text: increased === null ? `O brake bias ${before} → ${after} muda o equilíbrio em frenagem.` : increased ? `Mais brake bias dianteiro (${before} → ${after}) deixa o carro mais estável na frenagem, mas aumenta subesterço na entrada e sobrecarrega os pneus dianteiros.` : `Menos brake bias dianteiro (${before} → ${after}) deixa o carro mais traseiro e facilita a rotação na entrada, mas aumenta o risco de instabilidade e travamento traseiro no trail braking.`, actionable: true };
  if (/anti.?roll|arb|barra/.test(key)) {
    if (axleLabel === "dianteir") return { text: increased ? `Barra dianteira mais rígida (${before} → ${after}) dá resposta mais rápida na entrada, porém reduz aderência mecânica dianteira no meio da curva e tende a aumentar subesterço, principalmente em curvas de baixa velocidade.` : `Barra dianteira mais macia (${before} → ${after}) aumenta aderência e tolerância a zebras na frente, mas deixa a resposta de direção mais lenta e aumenta a rolagem dianteira.`, actionable: true };
    if (axleLabel === "traseir") return { text: increased ? `Barra traseira mais rígida (${before} → ${after}) ajuda o carro a rotacionar na entrada e no meio da curva, mas reduz tração na saída e pode provocar sobresterço em curvas rápidas ou pista molhada.` : `Barra traseira mais macia (${before} → ${after}) melhora tração na saída e estabilidade em curvas rápidas, mas tende a aumentar subesterço no meio da curva.`, actionable: true };
    return { text: `A alteração na barra estabilizadora (${before} → ${after}) redistribui rigidez lateral entre os pneus daquele eixo; combinada com o eixo oposto, define o balanço geral entre subesterço e sobresterço.`, actionable: true };
  }
  if (/spring|mola/.test(key)) {
    const axlePhrase = axleLabel ? `no eixo ${axleLabel}o` : "";
    return { text: increased === null ? `A mudança de mola ${axlePhrase} (${before} → ${after}) afeta a plataforma aerodinâmica, a resposta a transferência de carga e a capacidade de absorver zebras e ondulações.` : increased ? `Mola mais dura ${axlePhrase} (${before} → ${after}) mantém a plataforma mais estável sob carga aerodinâmica e frenagem, mas transmite mais impacto de zebras/ondulações e reduz aderência mecânica em pista irregular.` : `Mola mais macia ${axlePhrase} (${before} → ${after}) melhora absorção de zebras e aderência mecânica, mas aumenta a variação de altura sob carga, o que pode instabilizar a aerodinâmica em alta velocidade.`, actionable: true };
  }
  if (/ride height|altura/.test(key)) return { text: `A altura ${axleLabel ? `${axleLabel}a ` : ""}(${before} → ${after}) muda o rake do carro, o curso de suspensão disponível e a plataforma aerodinâmica; valide também legalidade mínima e risco de fundo raspando no chão.`, actionable: true };
  if (/camber|cambagem/.test(key)) return { text: `A cambagem ${axleLabel ? `${axleLabel}a ` : ""}(${before} → ${after}) altera a área de contato do pneu em apoio lateral, a temperatura interna/externa do pneu e o desempenho em frenagem/tração longitudinal.`, actionable: true };
  if (/toe|converg/.test(key)) return { text: `O toe ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) modifica a resposta inicial de direção, a estabilidade em reta, a geração de temperatura e o arrasto dos pneus.`, actionable: true };
  if (/damp|shock|bump|rebound|amort/.test(key)) {
    const isBump = /bump|compress/.test(key), isRebound = /rebound|extens/.test(key);
    if (isBump) return { text: `O amortecimento de compressão ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) controla a velocidade com que a suspensão absorve zebras e transferência de carga em frenagem/curva; mais rígido responde mais rápido mas transmite mais impacto.`, actionable: true };
    if (isRebound) return { text: `O amortecimento de extensão ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) controla a velocidade de retomada do pneu no solo após compressão; mais rígido reduz oscilação mas pode "empacar" o carro em sequência de curvas e zebras.`, actionable: true };
    return { text: `O amortecimento ${axleLabel ? `${axleLabel}o ` : ""}(${before} → ${after}) muda a velocidade de transferência de carga em frenagem, rotação, zebra e retomada de aderência.`, actionable: true };
  }
  if (/differential|diff|preload|coast|power/.test(key)) return { text: `O diferencial (${before} → ${after}) altera a rotação do carro em desaceleração/entrada de curva (coast) e a tração/estabilidade sob potência na saída (power); mais travado tende a estabilizar em reta e reduzir rotação na entrada.`, actionable: true };
  if (/pressure|pressao/.test(key)) return { text: `A pressão ${axleLabel ? `${axleLabel} ` : ""}(${before} → ${after}) afeta a janela térmica de trabalho do pneu, a deformação da carcaça, a resposta de direção e a área de contato; pressão muito baixa superaquece o pneu, muito alta reduz aderência.`, actionable: true };
  if (/gear|ratio|marcha/.test(key)) return { text: `A relação de marcha (${before} → ${after}) muda a aceleração disponível, a faixa de rotação usada e a velocidade máxima naquele estágio; confira se ainda bate no limitador antes das retas mais longas.`, actionable: true };
  if (/steering|direção|ackerman/.test(key)) return { text: `O ajuste de geometria de direção (${before} → ${after}) altera a relação entre o ângulo das rodas interna e externa em curva, afetando o esterçamento e o desgaste do pneu dianteiro interno.`, actionable: true };
  return { text: `O parâmetro em ${tab ?? "Setup"} • ${section ?? "Geral"} foi alterado de ${before} para ${after}; sem uma regra específica mapeada ainda — valide isoladamente o efeito em telemetria (frenagem, rotação e tração) antes de adotá-lo em corrida.`, actionable: false };
}

export function mappedRows(rows: DecodedRow[]) {
  return new Map(rows.filter((row) => row.is_mapped !== false && row.label).map((row) => [`${row.tab ?? "Outro"}::${row.section ?? "Geral"}::${row.label}`, String(row.metric_value ?? "—")]));
}

export function diffSetups(baseRows: DecodedRow[], comparisonRows: DecodedRow[]): ParsedChange[] {
  const a = mappedRows(baseRows), b = mappedRows(comparisonRows);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.filter((key) => a.get(key) !== b.get(key)).map((key) => {
    const [tab, section, label] = key.split("::");
    const before = a.get(key) ?? "—", after = b.get(key) ?? "—";
    const { text, actionable } = effect(label, before, after, section, tab);
    const from = numericOf(before), to = numericOf(after);
    const numericDelta = Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
    return { tab, section, label, before, after, explanation: text, category: categoryOf(label, section), actionable, numericDelta };
  });
}

export const CATEGORY_LABELS: Record<string, string> = {
  aero: "Aerodinâmica", brakes: "Freios", arb: "Barras estabilizadoras", springs: "Molas",
  ride_height: "Altura do carro", alignment: "Geometria/alinhamento", dampers: "Amortecedores",
  differential: "Diferencial", tires: "Pneus/pressão", gearing: "Relação de marcha", display: "Display", other: "Outros",
};
