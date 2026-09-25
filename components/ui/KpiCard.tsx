import type { ReactNode } from "react";
import { SPARK_H, SPARK_W, linePoints, sparkBars, sparkRange, stepPath } from "@/lib/sparkline";
import { Chip } from "./Chip";

export type KpiCategory = "sports" | "formula" | "road";
export type KpiTone = "gain" | "loss" | "neutral";

/** Minigráfico opcional do KpiCard, nos três formatos do mockup:
 * - `lines`: série atual sólida na cor da categoria + anterior tracejada (#5C6A9E), mesma escala;
 * - `steps`: contagem acumulada em degraus (vitórias);
 * - `bars`: ganho/perda por corrida (sequência), verde/vermelho. */
export type KpiSparkline =
  | { kind: "lines"; current: ReadonlyArray<number | null>; previous?: ReadonlyArray<number | null>; count?: number }
  | { kind: "steps"; values: ReadonlyArray<number>; count?: number }
  | { kind: "bars"; values: ReadonlyArray<number> };

const CATEGORY_COLOR: Record<KpiCategory, string> = { sports: "var(--ng-sports)", formula: "var(--ng-formula)", road: "var(--ng-road)" };
const PREVIOUS_COLOR = "#5C6A9E";

function Sparkline({ spark, category }: { spark: KpiSparkline; category: KpiCategory }) {
  const color = CATEGORY_COLOR[category];
  let body: ReactNode = null;
  if (spark.kind === "lines") {
    const [lo, hi] = sparkRange(spark.previous ? [spark.current, spark.previous] : [spark.current]);
    const count = spark.count ?? Math.max(spark.current.length, spark.previous?.length ?? 0);
    body = (
      <>
        {spark.previous && <polyline points={linePoints(spark.previous, lo, hi, count)} fill="none" stroke={PREVIOUS_COLOR} strokeWidth={2} strokeLinejoin="round" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        <polyline points={linePoints(spark.current, lo, hi, count)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </>
    );
  } else if (spark.kind === "steps") {
    body = <path d={stepPath(spark.values, spark.count)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
  } else {
    body = sparkBars(spark.values).map((bar, index) => (
      <rect key={index} x={bar.x} y={bar.y} width={12} height={bar.h} rx={1.5} fill={bar.positive ? "var(--ng-gain)" : "var(--ng-loss)"} />
    ));
  }
  return <svg className="ng-kpi-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden>{body}</svg>;
}

/** KpiCard do mockup (B.dc.html): barrinha vertical de 4px na cor da categoria dentro do cartão, à
 * esquerda (revisão aprovada 25/09/2026, substituiu a borda superior), rótulo 12px em caixa
 * alta, valor Chakra 30px, selo opcional (Safety Rating), tendência colorida, minigráfico opcional e
 * descrição apagada. Altura fixa de 168px como no mockup; `autoHeight` libera para usos sem gráfico. */
export function KpiCard({ category, label, value, badge, trend, trendTone = "neutral", sparkline, description, autoHeight, title }: {
  category: KpiCategory;
  label: ReactNode;
  value: ReactNode;
  badge?: ReactNode;
  trend?: ReactNode;
  trendTone?: KpiTone;
  sparkline?: KpiSparkline;
  description?: ReactNode;
  autoHeight?: boolean;
  title?: string;
}) {
  return (
    <div className="ng-kpi" data-category={category} data-auto-height={autoHeight ? "" : undefined} title={title}>
      <span className="ng-kpi-accent" aria-hidden />
      <div className="ng-kpi-label">{label}</div>
      <div className="ng-kpi-value-row">
        <div className="ng-kpi-value">{value}</div>
        {badge !== undefined && badge !== null && badge !== "" && <Chip variant="solid">{badge}</Chip>}
      </div>
      {trend !== undefined && <div className="ng-kpi-trend" data-tone={trendTone}>{trend}</div>}
      {sparkline && <Sparkline spark={sparkline} category={category} />}
      {description !== undefined && <div className="ng-kpi-desc">{description}</div>}
    </div>
  );
}

/** Cabeçalho de grupo de KPIs ("■ SPORTS CAR"). */
export function CategoryHeading({ category, children }: { category: KpiCategory; children: ReactNode }) {
  return (
    <div className="ng-category-heading">
      <span className="ng-category-swatch" data-category={category} />
      {children}
    </div>
  );
}
