/** Formatação pt-BR do Night Grid: sinal com menos tipográfico (−), vírgula decimal. */
export function signedNumber(value: number, digits = 0) {
  const abs = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${abs}`;
}
