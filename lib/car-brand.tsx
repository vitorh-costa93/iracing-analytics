"use client";

import { CarFront } from "lucide-react";
import type { SyntheticEvent } from "react";

/** Shared with components/PerformanceRanking.tsx's own ranking list (31/08/2026: "gostaria no
 * gráfico de barras de melhor volta, fossem usados os símbolos como está" -- Car Comparison's
 * ranking bars want the exact same manufacturer-icon treatment as the Overview page's own ranking,
 * not a re-derived one that could drift out of sync with which brands/overrides are recognized). */
export function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
}

const BRAND_LOGO_OVERRIDES: Record<string, string> = {
  mercedes: "https://upload.wikimedia.org/wikipedia/commons/b/b8/Mercedes-Benz_Star.svg",
  dallara: "https://upload.wikimedia.org/wikipedia/commons/6/60/Dallara_logo.svg",
};

export function manufacturerSlug(label: string) {
  const value = label.toLowerCase();
  const brands: [string[], string][] = [
    [["mclaren"], "mclaren"], [["mercedes"], "mercedes"], [["ferrari"], "ferrari"], [["porsche"], "porsche"], [["bmw"], "bmw"],
    [["ford"], "ford"], [["lamborghini"], "lamborghini"], [["aston martin"], "astonmartin"], [["chevrolet", "corvette"], "chevrolet"],
    [["acura"], "acura"], [["cadillac"], "cadillac"], [["toyota"], "toyota"], [["honda"], "honda"], [["audi"], "audi"], [["dallara"], "dallara"],
  ];
  return brands.find(([names]) => names.some((name) => value.includes(name)))?.[1] ?? null;
}

/** The icon cell itself (override SVG, simpleicons CDN fallback, or a generic car glyph) --
 * factored out of PerformanceRanking's inline JSX so any list of car names/labels can render the
 * same icon without re-deriving the override/CDN logic. */
export function CarBrandIcon({ name, size = 14 }: { name: string; size?: number }) {
  const brand = manufacturerSlug(name);
  if (!brand) return <CarFront size={size + 2} />;
  const src = BRAND_LOGO_OVERRIDES[brand] ?? `https://cdn.simpleicons.org/${brand}/1a1f26`;
  return (
    <span className="brand-icon-chip">
      <img className="brand-icon" src={src} alt={`Marca ${brand}`} width={size} height={size} onError={hideBrokenImage} />
    </span>
  );
}
