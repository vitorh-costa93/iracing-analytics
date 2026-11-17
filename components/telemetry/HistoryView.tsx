"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard, Panel, SegmentedControl, SelectPill } from "@/components/ui";
import { DeltaByContext, GapToWinner, gapOverall, type RankingItem, type WinnerGapItem } from "@/components/overview/PerformancePanels";
import { signedNumber } from "@/components/overview/format";
import type { LeftOnTable } from "@/lib/debrief-field";

type HistoricalRow = {
  ratingCategory: "formula_car" | "sports_car" | "road";
  carClass: string | null;
  car: string;
  track: string;
  races: number;
  delta: number;
  avgDelta: number;
};

type HistoryPayload = {
  status: string;
  seasons: Array<{ id: string; name: string }>;
  historical: HistoricalRow[];
  winnerGapBySegment: {
    sf: WinnerGapItem[];
    gt3: { track: WinnerGapItem[]; car: WinnerGapItem[] };
    imsa: Record<"all" | "GTP" | "LMP2", { track: WinnerGapItem[]; car: WinnerGapItem[] }>;
  };
  fieldSummary: {
    races: number;
    residualAvg: number | null;
    residualRaces: number;
    permanencePct: number | null;
    early: number;
    paceTopPct: number | null;
    leftOnTable: LeftOnTable;
  };
};

type Segment = "sf" | "gt3" | "imsa";
type RankingMode = "track" | "car";
type ImsaClass = "all" | "GTP" | "LMP2";

function aggregateRows(rows: HistoricalRow[], key: "car" | "track", includeGroup = false): RankingItem[] {
  const map = new Map<string, RankingItem>();
  for (const row of rows) {
    const label = row[key];
    const group = includeGroup ? row.carClass : null;
    const mapKey = `${group ?? ""}::${label}`;
    const current = map.get(mapKey) ?? { label, delta: 0, races: 0, group, avgDelta: 0 };
    current.delta += row.delta;
    current.races += row.races;
    map.set(mapKey, current);
  }
  for (const item of map.values()) item.avgDelta = item.races > 0 ? item.delta / item.races : 0;
  return [...map.values()].filter((item) => item.races >= 2).sort((a, b) => b.avgDelta - a.avgDelta);
}

function perKmText(v: number) {
  return `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} s/km`;
}

export default function HistoryView() {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("gt3");
  const [mode, setMode] = useState<RankingMode>("track");
  const [imsaClass, setImsaClass] = useState<ImsaClass>("all");
  const [seasonId, setSeasonId] = useState<string>("all");
  const [hoveredDot, setHoveredDot] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/telemetry/history?seasonId=${encodeURIComponent(seasonId)}&segment=${segment}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || json.status === "error") throw new Error(json.message ?? "Erro ao carregar histórico");
        if (alive) setData(json);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Erro ao carregar histórico"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [seasonId, segment]);

  const activeMode: RankingMode = segment === "sf" ? "track" : mode;

  const { perfItems, perfItemsPlain, totalRaces, gapItems } = useMemo(() => {
    if (!data) return { perfItems: [], perfItemsPlain: [], totalRaces: 0, gapItems: [] };
    const filtered = segment === "sf"
      ? data.historical.filter((r) => /super formula sf23/i.test(r.car))
      : segment === "gt3"
      ? data.historical.filter((r) => r.carClass === "GT3")
      : data.historical.filter((r) => (r.carClass === "GTP" || r.carClass === "LMP2") && (activeMode !== "track" || imsaClass === "all" || r.carClass === imsaClass));

    const total = filtered.reduce((sum, r) => sum + r.races, 0);
    const items = aggregateRows(filtered, activeMode, segment === "imsa");
    const plain = aggregateRows(filtered, activeMode, false);
    const seg = data.winnerGapBySegment;
    const gaps = (segment === "sf" ? seg?.sf
      : segment === "gt3" ? seg?.gt3?.[activeMode]
      : seg?.imsa?.[activeMode === "track" ? imsaClass : "all"]?.[activeMode]) ?? [];
    return { perfItems: items, perfItemsPlain: plain, totalRaces: total, gapItems: gaps };
  }, [data, segment, activeMode, imsaClass]);

  const quadrantPoints = useMemo(() => {
    const gapMap = new Map<string, WinnerGapItem>();
    for (const g of gapItems) gapMap.set(g.track, g);
    const points: Array<{ label: string; gapPerKm: number; avgDelta: number; races: number }> = [];
    for (const p of perfItemsPlain) {
      const g = gapMap.get(p.label);
      if (!g) continue;
      const metric = g.avgGapPerKm ?? g.avgGapPct;
      points.push({ label: p.label, gapPerKm: metric, avgDelta: p.avgDelta, races: p.races });
    }
    return points;
  }, [perfItemsPlain, gapItems]);

  if (loading && !data) return <div className="ngo-empty">Carregando histórico completo do iRacing…</div>;
  if (error || !data) return <div className="ngo-empty">{error ?? "Histórico indisponível."}</div>;

  const field = data.fieldSummary;
  const segLabel = segment === "sf" ? "SUPER FORMULA 23" : segment === "gt3" ? "GT3" : "IMSA GTP / LMP2";
  const avgGapKm = gapItems.length ? gapOverall(gapItems) : null;
  const seasonLabel = seasonId === "all" ? "todo o histórico" : (data.seasons.find((s) => s.id === seasonId)?.name ?? "season");

  const maxGapKm = Math.max(0.15, ...quadrantPoints.map((p) => p.gapPerKm));
  const minGapKm = Math.min(0, ...quadrantPoints.map((p) => p.gapPerKm));
  const midGapKm = (minGapKm + maxGapKm) / 2;
  const maxAbsDelta = Math.max(15, ...quadrantPoints.map((p) => Math.abs(p.avgDelta)));
  const qX = (g: number) => 56 + ((maxGapKm - g) / Math.max(0.01, maxGapKm - minGapKm)) * 510;
  const qY = (d: number) => 112 - (d / maxAbsDelta) * 84;
  const hovered = quadrantPoints.find((p) => p.label === hoveredDot) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div className="ngo-perf-head">
        <div className="ngo-perf-controls">
          <SegmentedControl
            ariaLabel="Segmento histórico"
            value={segment}
            onChange={setSegment}
            options={[
              { value: "sf", label: "Super Formula 23" },
              { value: "gt3", label: "GT3" },
              { value: "imsa", label: "IMSA GTP / LMP2" },
            ]}
          />
          {segment !== "sf" && (
            <SegmentedControl
              ariaLabel="Agrupar por"
              value={activeMode}
              onChange={setMode}
              options={[
                { value: "track", label: "Por Pista" },
                { value: "car", label: "Por Carro" },
              ]}
            />
          )}
          {segment === "imsa" && activeMode === "track" && (
            <SegmentedControl
              ariaLabel="Classe IMSA"
              value={imsaClass}
              onChange={setImsaClass}
              options={[
                { value: "all", label: "Todos" },
                { value: "GTP", label: "GTP" },
                { value: "LMP2", label: "LMP2" },
              ]}
            />
          )}
          {data.seasons.length > 0 && (
            <SelectPill
              ariaLabel="Filtrar por season"
              value={seasonId}
              onChange={setSeasonId}
              options={[
                { value: "all", label: "Todas as seasons (Histórico)" },
                ...data.seasons.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
        </div>
      </div>

      {/* 3 KPIs compactos no topo (sem Saldo Acumulado) */}
      <div className="ngo-kpi-grid ng-hist-kpis">
        <KpiCard
          category={segment === "sf" ? "formula" : "sports"}
          label="Corridas no histórico"
          value={totalRaces.toLocaleString("pt-BR")}
          trend={`${segLabel} · ${seasonLabel}`}
          trendTone="neutral"
        />
        <KpiCard
          category={segment === "sf" ? "formula" : "sports"}
          label="Realizado vs. Esperado"
          value={field.residualAvg === null ? "—" : signedNumber(field.residualAvg, 1)}
          trend={`Média/corrida vs. Elo (${field.residualRaces} corr. com campo)`}
          trendTone={field.residualAvg === null || field.residualAvg === 0 ? "neutral" : field.residualAvg > 0 ? "gain" : "loss"}
        />
        <KpiCard
          category={segment === "sf" ? "formula" : "sports"}
          label="Taxa de conclusão"
          value={field.permanencePct != null ? `${field.permanencePct}%` : "—"}
          trend={`${field.early} saída(s) antecipada(s) · deixado: ${field.leftOnTable.total > 0 ? `-${field.leftOnTable.total} iR` : "0 iR"}`}
          trendTone={field.permanencePct != null && field.permanencePct < 80 ? "loss" : "gain"}
        />
      </div>

      {/* Medida 1 & Medida 2 com linhas compactas */}
      <div className="ngo-perf-grid ng-hist-perf">
        <Panel
          kicker={`MEDIDA 1 · ${segLabel}`}
          title={`Média de Δ iRating por ${activeMode === "car" ? "carro" : "pista"}`}
          titleSize="sm"
          as="article"
          subtitle="5 maiores ganhos e 5 maiores perdas (mín. 2 corridas)"
        >
          <DeltaByContext items={perfItems} kind={activeMode} />
        </Panel>
        <Panel
          kicker={`MEDIDA 2 · ${segLabel} · GAP NORMALIZADO POR KM`}
          title={`Sua melhor volta vs. melhor da classe (s/km), por ${activeMode === "car" ? "carro" : "pista"}`}
          titleSize="sm"
          as="article"
          subtitle={`Gap em s ÷ extensão em km · 5 menores e 5 maiores${avgGapKm !== null ? ` · média ${perKmText(avgGapKm)}` : ""}`}
        >
          <GapToWinner items={gapItems} kind={activeMode} />
        </Panel>
      </div>

      {/* Matriz Ritmo × Conversão + Sobrevivência */}
      <div className="ngo-perf-grid">
        <Panel
          kicker="MATRIZ RITMO × CONVERSÃO"
          title="Onde você é rápido vs. onde realmente pontua"
          titleSize="sm"
          as="article"
          subtitle={`Cruza gap (s/km, mais rápido à direita) com Δ médio de iRating · ${seasonLabel}.`}
        >
          {quadrantPoints.length < 2 ? (
            <div className="ngo-empty">Ainda sem pistas/carros suficientes com ambas as métricas neste recorte.</div>
          ) : (
            <svg viewBox="0 0 600 220" style={{ width: "100%", height: "220px", overflow: "visible" }} role="img" aria-label="Matriz Ritmo versus Conversão em iRating">
              <rect x={56} y={18} width={255} height={94} fill="rgba(255,176,32,.04)" />
              <rect x={311} y={18} width={255} height={94} fill="rgba(61,214,140,.06)" />
              <rect x={56} y={112} width={255} height={94} fill="rgba(255,107,107,.05)" />
              <rect x={311} y={112} width={255} height={94} fill="rgba(45,226,230,.04)" />
              <line x1={56} y1={112} x2={566} y2={112} stroke="#5C6A9E" strokeDasharray="4 3" />
              <line x1={qX(midGapKm)} y1={18} x2={qX(midGapKm)} y2={206} stroke="#5C6A9E" strokeDasharray="4 3" />
              <text x={558} y={32} textAnchor="end" fill="var(--ng-gain)" fontSize={10} fontWeight={700}>RÁPIDO &amp; PONTUA</text>
              <text x={558} y={198} textAnchor="end" fill="var(--ng-reference)" fontSize={10} fontWeight={700}>RÁPIDO, MAS PERDE iR</text>
              <text x={64} y={32} fill="var(--ng-caution)" fontSize={10} fontWeight={700}>SOBREVIVENTE</text>
              <text x={64} y={198} fill="var(--ng-loss)" fontSize={10} fontWeight={700}>PONTO CEGO</text>
              {quadrantPoints.map((pt) => {
                const cx = qX(pt.gapPerKm);
                const cy = qY(pt.avgDelta);
                const active = hoveredDot === pt.label;
                const fill = pt.avgDelta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)";
                return (
                  <g key={pt.label} style={{ cursor: "pointer" }} onMouseEnter={() => setHoveredDot(pt.label)} onMouseLeave={() => setHoveredDot(null)}>
                    <circle cx={cx} cy={cy} r={active ? 7 : 5} fill={fill} stroke="var(--ng-bg)" strokeWidth={1.5} />
                    <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--ng-text-2)" fontSize={9.5} fontWeight={600}>
                      {pt.label.length > 16 ? pt.label.slice(0, 15) + "…" : pt.label}
                    </text>
                  </g>
                );
              })}
              {hovered && (
                <g pointerEvents="none">
                  <rect x={Math.min(Math.max(qX(hovered.gapPerKm) - 95, 60), 370)} y={Math.max(qY(hovered.avgDelta) - 52, 6)} width={206} height={42} rx={6} fill="var(--ng-header)" stroke="var(--ng-tooltip-border)" />
                  <text x={Math.min(Math.max(qX(hovered.gapPerKm) - 85, 70), 380)} y={Math.max(qY(hovered.avgDelta) - 34, 24)} fontSize={11} fontWeight={600} fill="var(--ng-text)">{hovered.label}</text>
                  <text x={Math.min(Math.max(qX(hovered.gapPerKm) - 85, 70), 380)} y={Math.max(qY(hovered.avgDelta) - 18, 40)} fontSize={10} fill="var(--ng-muted)">{perKmText(hovered.gapPerKm)} · {signedNumber(hovered.avgDelta, 1)} iR/corr ({hovered.races})</text>
                </g>
              )}
              <text x={311} y={218} textAnchor="middle" fill="var(--ng-soft)" fontSize={10}>← Maior gap (s/km) · Menor gap (s/km) →</text>
            </svg>
          )}
        </Panel>

        <Panel
          kicker="SOBREVIVÊNCIA &amp; IRATING DEIXADO NA PISTA"
          title={`Onde o iRating escapou (${seasonLabel})`}
          titleSize="sm"
          as="article"
          subtitle={`Base: ${field.races} corridas oficiais no recorte.`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="ngo-kpi-grid">
              <div style={{ background: "var(--ng-card-2)", borderRadius: "8px", padding: "9px 12px" }}>
                <div style={{ fontSize: "11px", color: "var(--ng-muted)" }}>Ritmo no grid</div>
                <div style={{ fontFamily: "var(--ng-font-display)", fontSize: "18px", fontWeight: 700 }}>
                  {field.paceTopPct != null ? `Top ${field.paceTopPct}%` : "—"}
                </div>
              </div>
              <div style={{ background: "var(--ng-card-2)", borderRadius: "8px", padding: "9px 12px" }}>
                <div style={{ fontSize: "11px", color: "var(--ng-muted)" }}>Saídas precoces</div>
                <div style={{ fontFamily: "var(--ng-font-display)", fontSize: "18px", fontWeight: 700, color: field.early > 0 ? "var(--ng-loss)" : "var(--ng-gain)" }}>
                  {field.early}
                </div>
              </div>
              <div style={{ background: "var(--ng-card-2)", borderRadius: "8px", padding: "9px 12px" }}>
                <div style={{ fontSize: "11px", color: "var(--ng-muted)" }}>Deixado na pista</div>
                <div style={{ fontFamily: "var(--ng-font-display)", fontSize: "18px", fontWeight: 700, color: "var(--ng-loss)" }}>
                  {field.leftOnTable.total > 0 ? `-${field.leftOnTable.total} iR` : "0 iR"}
                </div>
              </div>
            </div>
            {field.leftOnTable.top.slice(0, 4).map((r) => (
              <div key={`${r.date}-${r.track}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "var(--ng-card-2)", borderRadius: "6px", fontSize: "12px" }}>
                <span style={{ color: "var(--ng-text-2)" }}><strong>{r.track}</strong> · {r.car}</span>
                <span style={{ color: "var(--ng-loss)", fontWeight: 600 }}>esp {signedNumber(r.expected)} → real {signedNumber(r.real)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
