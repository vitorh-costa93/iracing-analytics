"use client";

import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

/** Seletor segmentado do mockup (ex.: Sports Car / Formula Car, Pista / Carro): trilho #0E1322 com
 * padding 3px e raio 8px; botões de 28px, raio 5px; o ativo fica em #222C50 com texto em 600. */
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, className }: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={className ? `ng-segmented ${className}` : "ng-segmented"} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => { if (option.value !== value) onChange(option.value); }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
