"use client";

import Link from "next/link";
import { Activity, Gauge, Wrench, Bookmark, X, ClipboardList, CalendarDays } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Renamed 29/08/2026 (kept the routes/hrefs as-is, only the labels changed): Overview stays,
// Telemetria -> Analysis, Setup -> Laboratory.
const tabs = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/telemetry", label: "Analysis", icon: Activity },
  { href: "/setup", label: "Laboratory", icon: Wrench },
];

const IRSTATS_BOOKMARKLET = "javascript:(function(){var d=document,s=d.createElement('script');s.src='https://iracing-analytics.vercel.app/irstats-import.js?v='+Date.now();d.body.appendChild(s);})();";
const GARAGE61_BOOKMARKLET = "javascript:(function(){var d=document,s=d.createElement('script');s.src='https://iracing-analytics.vercel.app/garage61-import.js?v='+Date.now();d.body.appendChild(s);})();";

/** React 18+ sanitizes any `href` it sees containing "javascript:" set through JSX -- it silently
 * swaps the real bookmarklet code for `javascript:throw new Error('React has blocked a javascript:
 * URL as a security precaution.')` (an XSS guard against an href built from untrusted data). That's
 * a real, confirmed bug here (29/08/2026): dragging the link to the bookmarks bar saved a bookmark
 * that just threw that error instead of running the import -- "não funcionou no computador" was this,
 * not a browser/OS quirk. These two links are hardcoded literals, not untrusted input, so the guard is
 * a false positive for them -- worked around by setting href imperatively via a ref, which never goes
 * through JSX's attribute sanitizer at all. */
function BookmarkletLink({ href, children }: { href: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => { ref.current?.setAttribute("href", href); }, [href]);
  return <a ref={ref} className="manual-sync-bookmarklet" onClick={(event) => event.preventDefault()}>{children}</a>;
}

type ReportCategory = "formula_car" | "sports_car";
type ReportSection = { category: ReportCategory; week?: number | null; paragraphs: string[] };
type ReportResponse = { status: string; message?: string; scope: "season" | "week"; seasonName: string; previousSeasonName: string; generatedAt: string; sections: ReportSection[] };

const CATEGORY_LABEL: Record<ReportCategory, string> = { formula_car: "Formula Car", sports_car: "Sports Car" };

/** 05/09/2026: "se comportar como se fosse meu engenheiro... um relatório bem descritivo" -- botão +
 * popup reaproveitando exatamente o mesmo .insight-popup-backdrop/.insight-popup já usado por
 * Favoritos e pelos popups de curva (components/ActiveWeekTelemetry.tsx), pra manter a mesma
 * linguagem visual em vez de inventar um terceiro estilo de modal. Busca sempre nova ao abrir (sem
 * cache) -- o relatório precisa refletir o resultado mais recente assim que o piloto sincroniza,
 * exatamente como a Overview inteira já faz (dynamic="force-dynamic"). */
function EngineerReportButton({ scope, label, Icon }: { scope: "season" | "week"; label: string; Icon: typeof ClipboardList }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/report?scope=${scope}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ReportResponse;
        if (!response.ok || result.status !== "ok") throw new Error(result.message ?? "Não foi possível gerar o relatório");
        setData(result);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao gerar o relatório"))
      .finally(() => setLoading(false));
  }

  return (
    <>
      <button type="button" className="app-tabs-action" onClick={handleOpen}>
        <Icon size={15} aria-hidden />{label}
      </button>
      {open && (
        <div className="insight-popup-backdrop" onClick={() => setOpen(false)}>
          <div className="insight-popup engineer-report-popup" onClick={(event) => event.stopPropagation()}>
            <div className="insight-popup-head">
              <div>
                <span className="section-kicker">SEU ENGENHEIRO</span>
                <h3>{scope === "season" ? "Resumo da season" : "Resumo da semana"}</h3>
                {data && <p className="insight-popup-detail">{data.seasonName} vs. {data.previousSeasonName}{data.scope === "week" ? "" : " — season até aqui"}.</p>}
              </div>
              <button type="button" className="insight-popup-close" onClick={() => setOpen(false)}>Fechar <X size={14} /></button>
            </div>
            {loading && <div className="telemetry-state">Cruzando iRating, vitórias, Safety Rating e contexto de corrida…</div>}
            {error && <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={handleOpen}>Tentar novamente</button></div>}
            {data && !loading && !error && (
              <div className="engineer-report-body">
                {data.sections.map((section) => (
                  <article className="engineer-report-section" key={section.category}>
                    <h4>{CATEGORY_LABEL[section.category]}{section.week ? ` • Week ${section.week}` : ""}</h4>
                    {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function AppTabs() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className="app-tabs" aria-label="Áreas do Racing Analytics">
        {tabs.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={pathname === href ? "active" : ""}>
            <Icon size={15} aria-hidden />{label}
          </Link>
        ))}
        <div className="app-tabs-actions">
          <EngineerReportButton scope="season" label="Resumo da season" Icon={ClipboardList} />
          <EngineerReportButton scope="week" label="Resumo da semana" Icon={CalendarDays} />
          <button type="button" className="app-tabs-action" onClick={() => setOpen(true)}>
            <Bookmark size={15} aria-hidden />Favoritos
          </button>
        </div>
      </nav>
      {open && (
        <div className="insight-popup-backdrop" onClick={() => setOpen(false)}>
          <div className="insight-popup" onClick={(event) => event.stopPropagation()}>
            <div className="insight-popup-head">
              <div>
                <span className="section-kicker">CONFIGURAÇÃO ÚNICA — NÃO SÃO BOTÕES DAQUI</span>
                <h3>Favoritos para resultados e setups</h3>
                <p className="insight-popup-detail">Resultados (iRStats) e setups (Garage61) só existem em sites de terceiros que bloqueiam acesso automático — não tem como um clique nesta página alcançar outra aba de outro site. Os dois links abaixo não são pra clicar aqui: <strong>arraste cada um pra barra de favoritos do navegador, uma vez só</strong>. Depois, quando quiser resultados ou setups novos, abra o site correspondente (os botões &quot;iRStats ↗&quot; / &quot;Garage61 ↗&quot; na Overview abrem pra você) já logado e clique no favorito lá.</p>
              </div>
              <button type="button" className="insight-popup-close" onClick={() => setOpen(false)}>Fechar <X size={14} /></button>
            </div>
            <div className="manual-sync-grid">
              <BookmarkletLink href={IRSTATS_BOOKMARKLET}>
                <strong>🔖 Arraste → iRStats: importar resultados</strong>
                <span>Depois de arrastado: abra irstats.com/driver/958741 logado e clique nele lá.</span>
              </BookmarkletLink>
              <BookmarkletLink href={GARAGE61_BOOKMARKLET}>
                <strong>🔖 Arraste → Garage61: importar setups</strong>
                <span>Depois de arrastado: abra garage61.net/app logado e clique nele lá.</span>
              </BookmarkletLink>
            </div>
            <p className="comparison-note">No celular, arrastar não funciona: toque e segure para copiar o link, crie um favorito qualquer e edite a URL dele colando o link copiado. Só funciona no Safari do iPhone — o Chrome bloqueia favoritos com javascript:, tanto no Android quanto no iPhone (é restrição do próprio app do Chrome, existe mesmo no iPhone onde ele usa o motor do Safari por baixo). Fora do Safari, só dá pra fazer pelo computador mesmo.</p>
          </div>
        </div>
      )}
    </>
  );
}
