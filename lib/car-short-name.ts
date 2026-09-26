/** Nome curto de um carro para frases e legendas ("o Cadillac", "o Mustang"), como no
 * Compare.dc.html. Marca na maioria dos casos; modelo quando é assim que o carro é chamado. */
const SPECIAL: [RegExp, string][] = [
  [/aston martin/i, "Aston Martin"],
  [/mustang/i, "Mustang"],
  [/corvette/i, "Corvette"],
  [/mercedes/i, "Mercedes"],
  [/super formula/i, "SF23"],
  [/dallara p217/i, "Dallara"],
];

export function shortCarName(name: string) {
  const trimmed = name.trim();
  for (const [pattern, label] of SPECIAL) if (pattern.test(trimmed)) return label;
  return trimmed.split(/\s+/)[0] || trimmed;
}
