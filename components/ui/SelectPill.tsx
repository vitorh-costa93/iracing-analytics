"use client";

import type { CSSProperties } from "react";

export type SelectPillOption<T extends string> = { value: T; label: string; disabled?: boolean };

/** Seletor do mockup ("2026 Season 3 ▾", "Todas as séries (31) ▾"): 34px, fundo #0E1322, borda
 * #222C50, raio 8px, 13px. É um <select> nativo (teclado, leitor de tela e toque de celular de graça)
 * com a seta ▾ apagada desenhada por cima. `label` opcional vira o rótulo em caixa alta à esquerda
 * ("CARRO E PISTA" no Setup.dc.html); sem ele, `ariaLabel` é obrigatório na prática. */
export function SelectPill<T extends string>({ options, value, onChange, label, ariaLabel, disabled, className, style }: {
  options: ReadonlyArray<SelectPillOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const select = (
    <span className={className ? `ng-select ${className}` : "ng-select"} style={style}>
      <select
        value={value}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
      <span className="ng-select-arrow" aria-hidden>▾</span>
    </span>
  );
  if (!label) return select;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span className="ng-field-label">{label}</span>
      {select}
    </label>
  );
}
