"use client";

import { Bookmark, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// 25/09/2026 (redesign etapa 1): a navegação entre áreas saiu daqui para o cabeçalho global
// (components/AppHeader.tsx: Visão Geral, Telemetry Lab, Debriefs, Setup Lab). Esta faixa ficou só
// com o atalho "Favoritos" (bookmarklets de iRStats/Garage61) até as telas serem migradas.

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

export default function AppTabs() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className="app-tabs" aria-label="Importação por favoritos">
        <div className="app-tabs-actions">
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
