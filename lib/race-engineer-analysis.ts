export type Category = "formula_car" | "sports_car";

export type RaceInput = {
  raced_at: string;
  category: Category;
  series_name: string;
  track_name: string;
  car_name: string;
  season_week: number | null;
  finish_position: number;
  grid_position: number | null;
  position_change: number | null;
  irating_after: number;
  irating_before: number;
  sof: number | null;
  incidents: number | null;
};

type Group = { label: string; races: number; delta: number; avgDelta: number; avgIncidents: number | null; avgPositionChange: number | null; avgSof: number | null };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const avg = (values: Array<number | null | undefined>) => {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? sum(usable) / usable.length : null;
};
const round = (value: number | null, decimals = 1) => value === null ? null : Number(value.toFixed(decimals));
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
const delta = (race: RaceInput) => race.irating_after - race.irating_before;
const label = (category: Category) => category === "formula_car" ? "Formula Car" : "Sports Car";

function compare(rows: RaceInput[], name: string, predicate: (row: RaceInput) => boolean): Group {
  const items = rows.filter(predicate);
  const deltas = items.map(delta);
  return {
    label: name,
    races: items.length,
    delta: sum(deltas),
    avgDelta: items.length ? sum(deltas) / items.length : 0,
    avgIncidents: round(avg(items.map((row) => row.incidents))),
    avgPositionChange: round(avg(items.map((row) => row.position_change))),
    avgSof: round(avg(items.map((row) => row.sof)), 0),
  };
}

function groupContexts(rows: RaceInput[]) {
  const groups = new Map<string, RaceInput[]>();
  for (const row of rows) {
    const key = `${row.car_name} • ${row.track_name}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([context, items]) => ({
    context,
    races: items.length,
    delta: sum(items.map(delta)),
    avgDelta: sum(items.map(delta)) / items.length,
    wins: items.filter((row) => row.finish_position === 1).length,
    avgIncidents: round(avg(items.map((row) => row.incidents))),
    avgPositionChange: round(avg(items.map((row) => row.position_change))),
  })).sort((a, b) => a.delta - b.delta);
}

function confidence(rows: RaceInput[], previous: RaceInput[]) {
  if (rows.length >= 12 && previous.length >= 8) return "alta";
  if (rows.length >= 6) return "média";
  return "baixa";
}

export function buildEngineerSection(category: Category, rows: RaceInput[], previous: RaceInput[], scope: "week" | "season", week: number | null) {
  const races = [...rows].sort((a, b) => new Date(a.raced_at).getTime() - new Date(b.raced_at).getTime());
  const net = sum(races.map(delta));
  const previousNet = sum(previous.map(delta));
  const positive = compare(races, "Ganharam iRating", (row) => delta(row) > 0);
  const negative = compare(races, "Perderam iRating", (row) => delta(row) < 0);
  const wins = compare(races, "Vitórias", (row) => row.finish_position === 1);
  const nonWins = compare(races, "Demais corridas", (row) => row.finish_position !== 1);
  const podiums = races.filter((row) => row.finish_position <= 3).length;
  const clean = compare(races, "0 incidentes", (row) => row.incidents === 0);
  const highIncident = compare(races, "4+ incidentes", (row) => (row.incidents ?? -1) >= 4);
  const positionLoss = compare(races, "Perdeu posições", (row) => (row.position_change ?? 0) < 0);
  const positionGain = compare(races, "Ganhou posições", (row) => (row.position_change ?? 0) > 0);
  const contexts = groupContexts(races);
  const totalLoss = Math.abs(sum(races.filter((row) => delta(row) < 0).map(delta)));
  const topLosses = contexts.filter((item) => item.delta < 0).slice(0, 3).map((item) => ({
    ...item,
    shareOfLosses: totalLoss ? round((Math.abs(item.delta) / totalLoss) * 100) : 0,
  }));
  const topGains = [...contexts].reverse().filter((item) => item.delta > 0).slice(0, 3);
  const avgIncidentsNegative = negative.avgIncidents;
  const avgIncidentsPositive = positive.avgIncidents;
  const avgSofNegative = negative.avgSof;
  const avgSofWins = wins.avgSof;
  const avgPosNegative = negative.avgPositionChange;
  const avgPosPositive = positive.avgPositionChange;

  const findings: Array<{ kind: "finding" | "watch" | "data"; title: string; text: string }> = [];
  findings.push({
    kind: net < 0 ? "finding" : "finding",
    title: net < 0 ? "O saldo foi decidido pelas derrotas, não pelas vitórias" : "O saldo é positivo, mas precisa ser sustentado",
    text: `${label(category)} teve ${races.length} corridas e fechou ${signed(net)} de iRating. Houve ${wins.races} vitória${wins.races === 1 ? "" : "s"} e ${podiums} pódio${podiums === 1 ? "" : "s"}, mas as ${negative.races} corrida${negative.races === 1 ? "" : "s"} negativas somaram ${signed(negative.delta)} (${signed(negative.avgDelta)} por corrida), contra ${signed(positive.delta)} nas ${positive.races} positivas. ${negative.races ? "É a assimetria entre o tamanho das perdas e dos ganhos que explica o saldo." : ""}`,
  });

  if (negative.races && positive.races && avgPosNegative !== null && avgPosPositive !== null) {
    const movementGap = avgPosNegative - avgPosPositive;
    findings.push({
      kind: movementGap < -2 ? "finding" : "watch",
      title: movementGap < -2 ? "A perda de posições acompanha as corridas negativas" : "Posição não separa claramente bons e maus resultados",
      text: `Nas corridas que perderam iRating, a variação média de posições foi ${signed(avgPosNegative)}; nas que ganharam, ${signed(avgPosPositive)}. ${movementGap < -2 ? "Isso aponta que a execução de corrida — largada, sobrevivência no tráfego e ritmo sustentado — pesa mais que uma volta rápida isolada." : "Essa diferença não é grande o bastante para culpar apenas largada ou ritmo de corrida."}`,
    });
  }

  if (negative.races && positive.races && avgIncidentsNegative !== null && avgIncidentsPositive !== null) {
    const incidentGap = avgIncidentsNegative - avgIncidentsPositive;
    findings.push({
      kind: incidentGap >= 1 ? "finding" : "watch",
      title: incidentGap >= 1 ? "Incidentes estão concentrados onde o resultado desanda" : "Incidentes existem, mas não explicam sozinhos o resultado",
      text: `As corridas negativas tiveram ${avgIncidentsNegative.toFixed(1)} incidentes em média, contra ${avgIncidentsPositive.toFixed(1)} nas positivas. ${incidentGap >= 1 ? "É uma associação forte e prioriza a revisão das corridas de maior perda. A fonte disponível traz o total; ela não autoriza chamar cada incidente de contato." : "Como a diferença é pequena, o número bruto de incidentes não sustenta, sozinho, a explicação da queda."}`,
    });
  }

  if (wins.races >= 2 && nonWins.races >= 4 && avgSofWins !== null && avgSofNegative !== null) {
    const sofGap = avgSofWins - avgSofNegative;
    findings.push({
      kind: Math.abs(sofGap) >= 250 ? "finding" : "watch",
      title: Math.abs(sofGap) >= 250 ? "O nível dos grids altera a leitura das vitórias" : "SoF não diferencia bem vitórias e perdas nesta amostra",
      text: `O SoF médio das vitórias foi ${Math.round(avgSofWins).toLocaleString("pt-BR")}; nas corridas negativas, ${Math.round(avgSofNegative).toLocaleString("pt-BR")}. ${sofGap <= -250 ? "As vitórias ocorreram, em média, em grids mais fracos. Elas contam como resultado, mas não compensam automaticamente uma sequência de perdas em grids mais fortes." : sofGap >= 250 ? "Você venceu, em média, grids mais fortes; a queda vem principalmente da frequência/tamanho das corridas ruins, não de vitórias fáceis." : "Com SoF parecido, o foco deve ficar na distribuição dos resultados e na execução, não na força do grid."}`,
    });
  }

  if (highIncident.races >= 2 && clean.races >= 2) {
    findings.push({
      kind: highIncident.avgDelta < clean.avgDelta ? "finding" : "watch",
      title: highIncident.avgDelta < clean.avgDelta ? "Risco alto custa mais que as corridas limpas" : "A amostra não mostra penalidade clara por incidente",
      text: `Em corridas limpas o delta médio foi ${signed(clean.avgDelta)}; com 4+ incidentes foi ${signed(highIncident.avgDelta)}. ${highIncident.avgDelta < clean.avgDelta ? "Não prova que cada incidente causou a perda, mas confirma que reduzir esse grupo é o ataque com melhor retorno esperado." : "A relação não está clara nesta amostra; revise contexto de pista e duração antes de transformar isso em regra."}`,
    });
  }

  if (!findings.some((finding) => finding.title.includes("O nível dos grids"))) {
    findings.push({
      kind: "data",
      title: "SoF: evidência ainda insuficiente para explicar as vitórias",
      text: "A comparação de SoF exige ao menos duas vitórias e um grupo razoável de resultados negativos. O debrief não vai atribuir a queda a “grids fracos” sem essa amostra.",
    });
  }

  const primary = topLosses[0];
  const action = primary
    ? `Prioridade 1: revisar ${primary.context} (${primary.races} corridas, ${signed(primary.delta)}; ${primary.shareOfLosses}% de todas as perdas). Assista primeiro às corridas negativas desse contexto e marque em que volta começou a perda de posições. Depois compare três voltas limpas consecutivas com sua melhor volta para validar ritmo repetível antes da próxima corrida.`
    : `Prioridade 1: proteja as corridas negativas. Compare largada, primeira volta e média de incidentes entre os resultados positivos e negativos antes de alterar setup.`;

  return {
    category,
    label: label(category),
    week,
    confidence: confidence(races, previous),
    headline: scope === "week" ? `Week ${week ?? "atual"}: ${signed(net)} de iRating em ${races.length} corridas.` : `Season até agora: ${signed(net)} de iRating em ${races.length} corridas.`,
    comparison: previous.length ? `Período equivalente anterior: ${signed(previousNet)} em ${previous.length} corridas; diferença de ${signed(net - previousNet)}.` : "Não há amostra equivalente anterior para comparação.",
    findings,
    action,
    metrics: { races: races.length, wins: wins.races, podiums, netDelta: round(net), totalIncidents: sum(races.map((row) => row.incidents ?? 0)), averageIncidents: round(avg(races.map((row) => row.incidents))), averagePositionChange: round(avg(races.map((row) => row.position_change))), averageSof: round(avg(races.map((row) => row.sof)), 0) },
    outcomeDistribution: [positive, negative, compare(races, "Neutras", (row) => delta(row) === 0)],
    incidentDistribution: [clean, compare(races, "1–3 incidentes", (row) => (row.incidents ?? -1) >= 1 && (row.incidents ?? -1) <= 3), highIncident],
    positionDistribution: [positionGain, compare(races, "Sem mudança", (row) => row.position_change === 0), positionLoss],
    topLosses,
    topGains,
    impactRaces: [...races].sort((a,b) => Math.abs(delta(b)) - Math.abs(delta(a))).slice(0, 8).map((row) => ({
      date: row.raced_at, delta: round(delta(row)), finish: row.finish_position, grid: row.grid_position,
      positionChange: row.position_change, incidents: row.incidents, sof: row.sof,
      context: row.car_name + " • " + row.track_name,
      lossShare: delta(row) < 0 && totalLoss ? round(Math.abs(delta(row)) / totalLoss * 100) : null,
    })),
    weeklyImpact: [...new Set(races.map(row => row.season_week).filter((value): value is number => value !== null))].sort((a,b) => a-b).map(weekNumber => {
      const weekRows = races.filter(row => row.season_week === weekNumber);
      return { week: weekNumber, races: weekRows.length, delta: round(sum(weekRows.map(delta))), incidents: round(avg(weekRows.map(row => row.incidents))), positionChange: round(avg(weekRows.map(row => row.position_change))) };
    }),
    raceTrace: races.slice(-24).reverse().map((row) => ({ date: row.raced_at, delta: round(delta(row)), finish: row.finish_position, grid: row.grid_position, positionChange: row.position_change, incidents: row.incidents, sof: row.sof, context: `${row.car_name} • ${row.track_name}` })),
    telemetryNote: "A fonte de telemetria guarda voltas, setores e flags, mas não expõe ainda um fluxo confiável de canais de volante/freio/acelerador nesta rota. Por isso, este debrief não inventa uma nota de “confiança nos inputs”; ela aparecerá quando houver amostra de canais sincronizados para o mesmo conjunto de corridas.",
  };
}
