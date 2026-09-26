import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 720px)";

/** true no celular (mesmo corte de app/night-grid-mobile.css); false no servidor e no primeiro render. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
