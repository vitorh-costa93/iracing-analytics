import type { CSSProperties, ReactNode } from "react";

/** Cartão padrão do Night Grid (docs/redesign-mockup): fundo #111830, borda #222C50, raio 10px.
 * `density="default"` = padding 16px 20px (painéis de gráfico/lista); `"compact"` = 14px 16px
 * (cartões de número, como os de Debrief). Cabeçalho opcional: kicker vermelho + título Chakra. */
export type PanelProps = {
  kicker?: ReactNode;
  title?: ReactNode;
  titleSize?: "sm" | "md" | "lg";
  subtitle?: ReactNode;
  actions?: ReactNode;
  density?: "default" | "compact";
  as?: "section" | "div" | "article" | "aside";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Panel({ kicker, title, titleSize = "sm", subtitle, actions, density = "default", as: Tag = "section", className, style, children }: PanelProps) {
  const hasHead = kicker !== undefined || title !== undefined || actions !== undefined;
  return (
    <Tag className={className ? `ng-panel ${className}` : "ng-panel"} data-density={density} style={style}>
      {hasHead && (
        <div className="ng-panel-head">
          <div className="ng-panel-head-text">
            {kicker !== undefined && <div className="ng-kicker">{kicker}</div>}
            {title !== undefined && <h2 className="ng-panel-title" data-size={titleSize}>{title}</h2>}
            {subtitle !== undefined && <div className="ng-panel-subtitle">{subtitle}</div>}
          </div>
          {actions !== undefined && <div className="ng-panel-head-actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

/** Título de página do mockup: sobrelinha 12px apagada + H1 Chakra 30px em caixa alta. */
export function PageTitle({ eyebrow, title, aside }: { eyebrow?: ReactNode; title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="ng-page-title">
      <div>
        {eyebrow !== undefined && <div className="ng-eyebrow">{eyebrow}</div>}
        <h1 className="ng-h1">{title}</h1>
      </div>
      {aside !== undefined && <div className="ng-page-title-aside">{aside}</div>}
    </div>
  );
}
