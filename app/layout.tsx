import { Big_Shoulders, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono" });

export const metadata = { title: "Racing Analytics" };

// Anti-flash theme init (02/09/2026, light mode toggle): runs before first paint so a returning
// visitor who picked "light" doesn't see a flash of the dark default while React hydrates. Reads
// localStorage directly (not a React state) because this has to execute synchronously, pre-render --
// components/ThemeToggle.tsx reads the same key back on mount to sync its own icon.
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.dataset.theme="light";}catch(e){}`;

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
