import type { ReactNode } from "react";

export type ChipTone = "neutral" | "gain" | "loss" | "brand" | "reference" | "sports" | "formula" | "road";

/** Etiquetas do mockup:
 * - `tag` (padrão): 22px, raio 5px, fundo = cor do tom a 13% ("amostra robusta · 31 voltas", "seu carro");
 * - `solid`: mesmo formato com fundo sólido azul do Safety Rating ("A 3.21" no KpiCard);
 * - `pill`: 28px, raio 14px, com borda (sugestões do Setup Lab); `surface="header"` usa o fundo #0E1322;
 * - `code`: 24×18px, raio 3px, sigla de classe/categoria ("SF", "GT3").
 * Com `onClick` vira <button>; sem, <span>. */
export function Chip({ children, tone = "neutral", variant = "tag", surface, onClick, title }: {
  children: ReactNode;
  tone?: ChipTone;
  variant?: "tag" | "solid" | "pill" | "code";
  surface?: "card" | "header";
  onClick?: () => void;
  title?: string;
}) {
  const common = { className: "ng-chip", "data-tone": tone, "data-variant": variant, "data-surface": surface, title };
  if (onClick) return <button type="button" {...common} onClick={onClick}>{children}</button>;
  return <span {...common}>{children}</span>;
}
