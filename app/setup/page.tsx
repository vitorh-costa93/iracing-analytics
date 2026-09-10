import AppTabs from "@/components/AppTabs";
import SetupLab from "@/components/SetupLab";
import ThemeToggle from "@/components/ThemeToggle";
import DataFreshness from "@/components/DataFreshness";

export const metadata = { title: "Setup Lab • Racing Analytics" };

export default function SetupPage() {
  return <main className="app-shell"><div className="app-frame"><header className="app-header compact-header"><div className="brand-block"><div className="brand-mark"><span /></div><div><div className="brand-kicker">RACING ANALYTICS</div><h1>Setup Lab</h1><p>Gerador e engenheiro para a semana ativa</p></div></div><ThemeToggle /></header><AppTabs /><DataFreshness surface="setup" /><SetupLab /></div></main>;
}
