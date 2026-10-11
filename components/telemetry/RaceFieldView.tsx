"use client";

import { useEffect, useState } from "react";
import { Chip, Panel, SegmentedControl, SelectPill } from "@/components/ui";
import { formatLapTime } from "@/lib/telemetry-trace";
import { signedSeconds, type RaceFieldView as FieldPayload, type RivalsSummary, type Rival } from "@/lib/race-field";

/**
 * "Campo da corrida" dentro do Race Debrief: resumo sempre visível e evidência em disclosures
 * (<details>). Dados de /api/telemetry/race-field (agregados, cache no servidor, sem polling aqui:
 * uma requisição por corrida aberta e uma por aba/filtro de rivais). CSS: app/night-grid-debrief.css (.ngf-).
 */
type Empty = { status: "empty"; message: string };
type Category = "sports_car" | "formula_car" | "road";
const CATEGORY_LABEL: Record<Category, string> = { sports_car: "Sports Car", formula_car: "Formula Car", road: "Road" };
const WEEK_OPTIONS = [4, 8, 16, 26];

const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");
const signedInt = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const toneOf = (value: number) => (value > 0 ? "gain" : value < 0 ? "loss" : undefined);

function useFetch<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | Empty | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!url) return;
    let active = true;
    setState((current) => ({ ...current, error: null, loading: true }));
    fetch(url)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || result.status === "error") throw new Error(result.message ?? "Erro ao carregar o campo");
        if (active) setState({ data: result, error: null, loading: false });
      })
      .catch((reason) => active && setState({ data: null, error: reason instanceof Error ? reason.message : String(reason), loading: false }));
    return () => { active = false; };
  }, [url, retry]);
  return { ...state, reload: () => setRetry((count) => count + 1) };
}

function Section({ n, title, summary, open, children }: { n: number; title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="ngf-section" open={open}>
      <summary><span className="ngf-n">{n}</span><span className="ngf-section-title">{title}</span><span className="ngf-section-summary">{summary}</span></summary>
      <div className="ngf-body">{children}</div>
    </details>
  );
}
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="ngf-stat"><div className="ngf-stat-label">{label}</div><div className="ngf-stat-value" data-tone={tone}>{value}</div>{sub && <div className="ngf-stat-sub">{sub}</div>}</div>;
}

function TrackTrend({ history, trackName }: { history: NonNullable<FieldPayload["trackHistory"]>; trackName: string | null | undefined }) {
  const points = history.points;
  if (points.length < 2) return <div className="ngr-note">Histórico em {trackName ?? "esta pista"}: ainda só {points.length} corrida com campo importado nesta classe.</div>;
  const values = points.map((point) => point.gapTop5 ?? point.gapTop1);
  const max = Math.max(...values, 0.1), min = Math.min(...values, 0), W = 320, H = 110, pad = 18;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2), y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const label = history.trend ? `${history.trend.label} (${signedSeconds(history.trend.slope, 2)} por corrida)` : "poucas corridas para tendência";
  return (
    <div className="ngf-trend">
      <div className="ngf-sub-title">Histórico em {trackName ?? "esta pista"} · mesma classe · {points.length} corridas</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Diferença da sua melhor volta para a média do top 5 do campo em ${points.length} corridas; tendência ${label}`} className="ngf-trend-chart">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="ngf-axis" />
        <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} className="ngf-line" />
        {points.map((point, i) => (
          <circle key={point.subsessionId} cx={x(i)} cy={y(values[i])} r={3.5} className="ngf-dot" data-last={i === points.length - 1}>
            <title>{`${shortDate(point.date)}${point.week ? ` · sem. ${point.week}` : ""}: ${signedSeconds(values[i])} do ${point.gapTop5 !== null ? "top 5" : "1º"} · ${point.rank}º de ${point.of}`}</title>
          </circle>
        ))}
      </svg>
      <div className="ngr-note">Sua melhor volta menos a média das 5 melhores de cada corrida (0 = no nível do top 5). Tendência: <strong data-trend={history.trend?.label}>{label}</strong>.</div>
    </div>
  );
}

function Scatter({ points }: { points: NonNullable<FieldPayload["quali"]>["points"] }) {
  const size = Math.max(...points.map((p) => Math.max(p.start, p.finish)), 2), S = 220, pad = 24;
  const at = (v: number) => pad + ((v - 1) / (size - 1)) * (S - pad * 2);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="ngf-scatter" role="img" aria-label="Posição de largada contra posição de chegada na classe; abaixo da diagonal o piloto perdeu posições">
      <line x1={at(1)} y1={at(1)} x2={at(size)} y2={at(size)} className="ngf-axis" />
      <text x={S - pad} y={pad - 8} className="ngf-axis-text" textAnchor="end">chegada →</text>
      <text x={pad} y={S - 6} className="ngf-axis-text">largada →</text>
      {points.map((p, i) => <circle key={i} cx={at(p.start)} cy={at(p.finish)} r={p.me ? 5 : 3} className={p.me ? "ngf-me" : "ngf-pt"} />)}
    </svg>
  );
}

function FieldTab({ data, retry }: { data: FieldPayload; retry?: () => void }) {
  void retry;
  const { pace, quali, irating, character: c } = data;
  const verdictTone = c.verdict.tone === "clean" ? "gain" : c.verdict.tone === "messy" ? "loss" : "caution";
  return (
    <>
      <div className="ngf-stats">
        <Stat label="Melhor volta no grid" value={pace?.best ? `${pace.best.rank}º de ${pace.best.of}` : "—"} sub={pace?.best ? `${signedSeconds(pace.best.gap)} da mais rápida` : "sem tempo de volta"} />
        <Stat label="Largada → chegada" value={quali?.mine ? `P${quali.mine.start} → P${quali.mine.finish}` : "—"} tone={quali?.mine ? toneOf(quali.mine.gained) : undefined} sub={quali?.mine ? `${quali.mine.gained === 0 ? "mesma posição" : `${quali.mine.gained > 0 ? "+" : "−"}${Math.abs(quali.mine.gained)} na classe`}` : "sem dados de classe"} />
        <Stat label="Δ iRating real × esperado" value={irating?.realDelta != null ? signedInt(irating.realDelta) : "—"} tone={irating?.realDelta != null ? toneOf(irating.realDelta) : undefined} sub={irating?.expectedDelta != null ? `esperado ${signedInt(irating.expectedDelta)} (P${irating.expectedPosition})` : "sem iRating de entrada"} />
        <Stat label="Caráter" value={c.verdict.label} tone={verdictTone} sub={c.verdict.reason} />
      </div>

      <Section n={1} title="Ritmo contra o grid" open summary={pace?.best ? `${pace.best.rank}º melhor volta · ${pace.average ? `${pace.average.rank}º ritmo sustentado` : "sem volta média"}` : "sem dados"}>
        {!pace?.best ? <div className="ngr-empty">Sem melhor volta registrada para você nesta corrida.</div> : (
          <>
            <div className="ngr-note">As 5 melhores voltas do campo na sua classe (uma por piloto) e quanto a sua melhor está de cada uma.</div>
            <div className="ngf-table" role="table" aria-label="Cinco melhores voltas do campo">
              <div className="ngf-row ngf-head" role="row"><span role="columnheader">#</span><span role="columnheader">Piloto</span><span role="columnheader">Melhor volta</span><span role="columnheader">Você está</span></div>
              {pace.top5.map((entry) => (
                <div key={entry.rank} className="ngf-row" role="row" data-me={entry.me}>
                  <span role="cell">{entry.rank}</span><span role="cell" className="ngf-name">{entry.name}{entry.me && <Chip tone="reference">você</Chip>}</span>
                  <span role="cell">{formatLapTime(entry.lap)}</span><span role="cell" data-tone={entry.me ? undefined : toneOf(-entry.diff)}>{entry.me ? "—" : signedSeconds(entry.diff)}</span>
                </div>
              ))}
              {!pace.top5.some((entry) => entry.me) && (
                <div className="ngf-row" role="row" data-me="true"><span role="cell">{pace.best.rank}</span><span role="cell" className="ngf-name">Você<Chip tone="reference">você</Chip></span><span role="cell">{formatLapTime(pace.best.value)}</span><span role="cell">{signedSeconds(pace.best.gap)} do 1º</span></div>
              )}
            </div>
            <div className="ngf-facts">
              {pace.average && <div><strong>Volta média</strong> {pace.average.rank}º de {pace.average.of} · {signedSeconds(pace.average.gap)} da melhor média (mediana do campo {signedSeconds(pace.average.medianGap)})</div>}
              {pace.spread && <div><strong>Média − melhor volta</strong> {dec(pace.spread.mine, 2)} s (mediana do campo {dec(pace.spread.median, 2)} s)</div>}
              <div><strong>Percentil</strong> mais rápido que {pace.best.percentile}% do campo na melhor volta</div>
            </div>
            {data.paceText && <p className="ngf-text">{data.paceText}</p>}
            {data.trackHistory && <TrackTrend history={data.trackHistory} trackName={data.trackName} />}
          </>
        )}
      </Section>

      <Section n={2} title="Classificação × corrida" summary={quali?.mine ? `largou P${quali.mine.start}, chegou P${quali.mine.finish}` : "sem dados"}>
        {!quali ? <div className="ngr-empty">Sem posições de largada e chegada na classe para comparar.</div> : (
          <div className="ngf-two">
            <Scatter points={quali.points} />
            <div>
              <div className="ngf-table" role="table" aria-label="Comparativo com o campo">
                <div className="ngf-row ngf-head ngf-3" role="row"><span role="columnheader">Comparativo</span><span role="columnheader">Você</span><span role="columnheader">Mediana do campo</span></div>
                <div className="ngf-row ngf-3" role="row"><span role="cell">Gap da pole (classificação)</span><span role="cell">{quali.mine?.qualGap != null ? signedSeconds(quali.mine.qualGap) : "—"}</span><span role="cell">{quali.field.medianQualGap != null ? signedSeconds(quali.field.medianQualGap) : "—"}</span></div>
                <div className="ngf-row ngf-3" role="row"><span role="cell">Gap da melhor volta (corrida)</span><span role="cell">{quali.mine?.raceGap != null ? signedSeconds(quali.mine.raceGap) : "—"}</span><span role="cell">{quali.field.medianRaceGap != null ? signedSeconds(quali.field.medianRaceGap) : "—"}</span></div>
                <div className="ngf-row ngf-3" role="row"><span role="cell">Retenção de ritmo</span><span role="cell">{quali.mine?.retention != null ? signedSeconds(quali.mine.retention, 2) : "—"}</span><span role="cell">{quali.field.medianRetention != null ? signedSeconds(quali.field.medianRetention, 2) : "—"}</span></div>
              </div>
              <div className="ngr-note">Retenção de ritmo = gap da melhor volta de corrida menos o gap de classificação. Negativo: você rendeu mais na corrida do que na classificação. Na classe, {quali.field.gainers} ganharam posições, {quali.field.losers} perderam e {quali.field.same} mantiveram. Abaixo da diagonal, o piloto perdeu posições.</div>
            </div>
          </div>
        )}
      </Section>

      <Section n={3} title="Contexto do Δ iRating" summary={irating?.realDelta != null && irating.expectedDelta != null ? `real ${signedInt(irating.realDelta)} · esperado ${signedInt(irating.expectedDelta)}` : "sem dados"}>
        {!irating ? <div className="ngr-empty">Sem iRating de entrada suficiente na classe para estimar o contexto.</div> : (
          <>
            <p className="ngf-text">
              Você entrou com o {irating.expectedPosition}º maior iRating da classe ({irating.myIrating.toLocaleString("pt-BR")}); o maior era {irating.leaderIrating.toLocaleString("pt-BR")}{irating.sof ? ` (SOF ${irating.sof.toLocaleString("pt-BR")})` : ""}.
              A posição esperada é a ordem de iRating na entrada; terminou em P{irating.actualPosition}
              {irating.aboveExpected != null && <>, {irating.aboveExpected >= 0 ? "acima" : "abaixo"} do esperado em {Math.abs(irating.aboveExpected)} de iRating.</>}
            </p>
            <div className="ngf-scenarios" aria-label="Δ iRating estimado por posição final">
              {irating.scenarios.map((s) => (
                <div key={s.position} className="ngf-scenario" data-tag={s.tag ?? undefined}><span>P{s.position}</span><strong>{signedInt(s.delta)}</strong><span className="ngr-note">{s.tag === "actual" ? "você chegou aqui" : s.tag === "expected" ? "esperado" : "modelo"}</span></div>
              ))}
            </div>
            <div className="ngf-table" role="table" aria-label="Classe por chegada">
              <div className="ngf-row ngf-head ngf-5" role="row"><span role="columnheader">Chegou</span><span role="columnheader">Piloto</span><span role="columnheader">iRating entrada</span><span role="columnheader">Esperado</span><span role="columnheader">Δ real</span></div>
              {irating.rows.map((r) => (
                <div key={`${r.finish}-${r.name}`} className="ngf-row ngf-5" role="row" data-me={r.me}>
                  <span role="cell">P{r.finish}</span><span role="cell" className="ngf-name">{r.name}{r.me && <Chip tone="reference">você</Chip>}</span><span role="cell">{r.irating.toLocaleString("pt-BR")}</span><span role="cell">P{r.expected || "—"}</span><span role="cell" data-tone={r.delta != null ? toneOf(r.delta) : undefined}>{r.delta != null ? signedInt(r.delta) : "—"}</span>
                </div>
              ))}
            </div>
            <div className="ngr-note">Como é calculado: o modelo é a fórmula de iRating da comunidade (probabilidade Elo contra cada rival da classe, (pilotos − posição − esperado − ajuste) × 200 / pilotos), uma estimativa e não o valor oficial. O Δ real é o que o iRacing creditou.{irating.modelAtActual != null && irating.realDelta != null ? ` Para o seu P${irating.actualPosition} o modelo dá ${signedInt(irating.modelAtActual)} e o iRacing creditou ${signedInt(irating.realDelta)}.` : ""}</div>
          </>
        )}
      </Section>

      <Section n={4} title="Caráter da corrida" summary={c.verdict.label}>
        <div className="ngf-stats">
          <Stat label="Bandeiras amarelas" value={c.cautions != null ? String(c.cautions) : "—"} sub={c.cautionLaps != null ? `${c.cautionLaps} voltas sob amarela` : undefined} />
          <Stat label="Trocas de liderança" value={c.leadChanges != null ? String(c.leadChanges) : "—"} sub="contagem oficial do iRacing" />
          <Stat label="Abandonos" value={String(c.retired)} sub={c.retiredReasons.length ? c.retiredReasons.map((r) => `${r.count} ${r.reason}`).join(" · ") : `de ${c.drivers} pilotos`} />
          <Stat label="Incidentes do campo" value={c.incidents.median != null ? `${dec(c.incidents.median, 0)} x` : "—"} sub={`mediana · você ${c.incidents.mine ?? "—"} x · ${c.incidents.highCount} com ${c.incidents.threshold} x ou mais`} />
        </div>
        <p className="ngf-text">{c.verdict.reason}{(c.weather.skies || c.weather.temperature || c.weather.rain) ? ` Clima: ${[c.weather.skies, c.weather.temperature, c.weather.humidity ? `umidade ${c.weather.humidity}` : null, c.weather.rain].filter(Boolean).join(" · ")}.` : ""}</p>
        <div className="ngr-note">Critério: mais de 25% de abandonos ou 3+ amarelas = bagunçada; sem amarela e até 10% de abandonos = limpa; no meio, com interrupções.</div>
      </Section>
    </>
  );
}

function RivalDetail({ rival }: { rival: Rival }) {
  return (
    <div className="ngf-detail">
      <div className="ngf-sub-title">Últimos {rival.recent.length} encontros (barra acima: você terminou à frente)</div>
      <div className="ngf-bars" role="img" aria-label={rival.recent.map((r) => `${shortDate(r.date)} ${r.track}: ${r.ahead ? "à frente" : "atrás"}`).join("; ")}>
        {rival.recent.map((r, i) => <span key={i} className="ngf-bar" data-ahead={r.ahead ? "up" : "down"} title={`${shortDate(r.date)} · ${r.track}`} />)}
      </div>
      <div className="ngf-facts">
        <div><strong>Pistas em comum</strong> {rival.tracks.join(", ")}</div>
        <div><strong>Largada média dele</strong> {rival.avgStart != null ? `P${dec(rival.avgStart)}` : "—"}</div>
        <div><strong>Incidentes médios dele</strong> {rival.avgIncidents != null ? `${dec(rival.avgIncidents)} x` : "—"}</div>
        <div><strong>Δ iRating médio dele</strong> {rival.avgIratingDelta != null ? signedInt(rival.avgIratingDelta) : "—"}</div>
      </div>
    </div>
  );
}

function RivalsTab({ initial }: { initial: Category }) {
  const [category, setCategory] = useState<Category>(initial);
  const [weeks, setWeeks] = useState(8);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<RivalsSummary & { status: "ok"; truncated: boolean }>(`/api/telemetry/race-field?view=rivals&category=${category}&weeks=${weeks}`);
  return (
    <>
      <div className="ngr-toolbar">
        <SegmentedControl ariaLabel="Categoria dos rivais" value={category} onChange={(value) => { setCategory(value); setOpen(null); }}
          options={(Object.keys(CATEGORY_LABEL) as Category[]).map((value) => ({ value, label: CATEGORY_LABEL[value] }))} />
        <SelectPill ariaLabel="Janela de tempo" value={String(weeks)} options={WEEK_OPTIONS.map((w) => ({ value: String(w), label: `últimas ${w} semanas` }))} onChange={(value) => { setWeeks(Number(value)); setOpen(null); }} />
        <span className="ngr-note">mínimo de 3 encontros na mesma classe · pilotos identificados pelo nome do iRacing</span>
        {loading && <span className="ngr-loading">carregando…</span>}
      </div>
      {error && <div className="ngt-state" data-tone="error">{error}<button type="button" className="ngt-link-button" onClick={reload}>Tentar novamente</button></div>}
      {data && data.status === "empty" && <div className="ngr-empty">{data.message}</div>}
      {data && data.status === "ok" && (data.rivals.length === 0 ? <div className="ngr-empty">Nenhum piloto apareceu em 3 ou mais das suas {data.races} corridas desta categoria na janela ({data.opponentsTotal} adversários vistos).</div> : (
        <>
          <div className="ngf-stats">
            <Stat label="Rivais recorrentes" value={String(data.rivalsCount)} sub={`de ${data.opponentsTotal} pilotos enfrentados em ${data.races} corridas`} />
            <Stat label="Placar geral" value={`${data.ahead} × ${data.behind}`} tone={toneOf(data.ahead - data.behind)} sub="chegadas à frente × atrás" />
            <Stat label="Mais frequente" value={data.mostFrequent?.name ?? "—"} sub={data.mostFrequent ? `${data.mostFrequent.encounters} encontros · ${data.mostFrequent.tracks.slice(0, 2).join(", ")}` : undefined} />
            <Stat label="Rival mais difícil" value={data.hardest?.name ?? "—"} tone={data.hardest ? "loss" : undefined} sub={data.hardest ? `${data.hardest.ahead} × ${data.hardest.behind}${data.hardest.paceDiff != null ? ` · ${signedSeconds(data.hardest.paceDiff, 2)} de ritmo` : ""}` : "ninguém com saldo negativo"} />
          </div>
          <div className="ngf-table" role="table" aria-label="Rivais recorrentes">
            <div className="ngf-row ngf-head ngf-rival" role="row"><span role="columnheader">Piloto</span><span role="columnheader">Encontros</span><span role="columnheader">Placar direto</span><span role="columnheader">Ritmo médio</span><span role="columnheader">iRating</span><span role="columnheader">Último</span></div>
            {data.rivals.map((rival) => (
              <div key={rival.custId} role="rowgroup">
                <button type="button" className="ngf-row ngf-rival ngf-button" role="row" aria-expanded={open === rival.custId} aria-label={`${rival.name}: ${rival.encounters} encontros, placar ${rival.ahead} a ${rival.behind}`} onClick={() => setOpen(open === rival.custId ? null : rival.custId)}>
                  <span role="cell" className="ngf-name">{rival.name}{rival.country && <em>{rival.country}</em>}</span>
                  <span role="cell">{rival.encounters}</span>
                  <span role="cell" data-tone={toneOf(rival.ahead - rival.behind)}>{rival.ahead} × {rival.behind}</span>
                  <span role="cell" title="Sua melhor volta menos a dele, média dos encontros; negativo = você mais rápido">{rival.paceDiff != null ? signedSeconds(rival.paceDiff, 2) : "—"}</span>
                  <span role="cell">{rival.irating ? rival.irating.toLocaleString("pt-BR") : "—"}</span>
                  <span role="cell">{shortDate(rival.last)}</span>
                </button>
                {open === rival.custId && <RivalDetail rival={rival} />}
              </div>
            ))}
          </div>
          <div className="ngr-note">Placar direto: quem terminou à frente na classe, só em corridas em que os dois largaram. Ritmo: sua melhor volta menos a dele (negativo = você mais rápido).{data.truncated ? " Janela grande: parte das corridas pode ter ficado de fora." : ""}</div>
        </>
      ))}
    </>
  );
}

export default function RaceFieldView({ subsessionId, category }: { subsessionId: number; category: string | null }) {
  const [tab, setTab] = useState<"field" | "rivals">("field");
  const { data, error, loading, reload } = useFetch<FieldPayload>(`/api/telemetry/race-field?subsessionId=${subsessionId}`);
  const field = data && data.status === "ok" ? data : null;
  const initialCategory: Category = category === "formula_car" || category === "road" ? category : "sports_car";
  const subtitle = field ? [`${field.drivers} pilotos`, field.classLabel ? `${field.classLabel} · ${field.classSize} na classe` : null, field.split ? `split ${field.split.index} de ${field.split.total}` : null, field.sof ? `SOF ${field.sof.toLocaleString("pt-BR")}` : null].filter(Boolean).join(" · ") : "Todos os pilotos humanos da corrida oficial, com nome";
  return (
    <Panel kicker="Resultado oficial do iRacing" title="Campo da corrida" subtitle={subtitle}
      actions={<SegmentedControl ariaLabel="Visão do campo" value={tab} onChange={setTab} options={[{ value: "field", label: "Visão do campo" }, { value: "rivals", label: "Rivais recorrentes" }]} />}>
      <div className="ngf" aria-busy={loading}>
        {tab === "rivals" ? <RivalsTab initial={initialCategory} /> : (
          <>
            {loading && !data && <div className="ngr-empty">Carregando o campo da corrida…</div>}
            {error && <div className="ngt-state" data-tone="error">{error}<button type="button" className="ngt-link-button" onClick={reload}>Tentar novamente</button></div>}
            {data && data.status === "empty" && <div className="ngr-empty">{data.message} O agente do iRacing importa o campo junto com o resultado oficial.</div>}
            {field && <FieldTab data={field} />}
          </>
        )}
      </div>
    </Panel>
  );
}
