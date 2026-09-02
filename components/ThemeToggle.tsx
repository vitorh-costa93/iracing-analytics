"use client";

import { useEffect, useState } from "react";

/** Manual dark/light toggle (02/09/2026: "queria ver contigo a possibilidade de um light mode...
 * toggle manual, botão no header pra trocar a qualquer momento, escolha salva localmente") -- reads/
 * writes `data-theme` on <html> (see app/layout.tsx's inline anti-flash script, which sets the initial
 * value from localStorage before first paint) and persists the choice in localStorage so it survives a
 * reload. Dark is the default when nothing is stored yet, matching the app's original look. */
const STORAGE_KEY = "theme";

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode / storage blocked -- theme still applies for this load */ }
}

export default function ThemeToggle() {
  // Starts undefined (not "dark") so this button doesn't render a wrong icon for a split second on a
  // page where the anti-flash script already set data-theme="light" -- read the real value on mount.
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light" | undefined) ?? "dark");
  }, []);

  if (!theme) return null;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => { const next = theme === "dark" ? "light" : "dark"; applyTheme(next); setTheme(next); }}
      aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={theme === "dark" ? "Tema claro" : "Tema escuro"}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
      )}
    </button>
  );
}
