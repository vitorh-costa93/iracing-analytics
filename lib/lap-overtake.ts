/**
 * Sinal direto de Overtake/P2P na volta (payload Garage61 ou do agente). `p2p: true` vem do Garage61,
 * `pushToPass` do agente e `p2pStatus` de CSVs. `p2pCount` é um contador cumulativo da sessão e NÃO
 * indica uso na volta, por isso não entra aqui.
 */
export type OvertakeSignals = { p2p?: boolean | number | null; pushToPass?: boolean | number | null; p2pStatus?: boolean | number | null };

export function lapUsedOvertake(lap: OvertakeSignals): boolean {
  return lap.p2p === true || lap.pushToPass === true || lap.p2pStatus === true
    || (typeof lap.pushToPass === "number" && lap.pushToPass > 0)
    || (typeof lap.p2pStatus === "number" && lap.p2pStatus > 0);
}
