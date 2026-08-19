import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import AppTabs from "@/components/AppTabs";

export const metadata = { title: "Telemetry Lab • Racing Analytics" };

export default function TelemetryPage() {
  return (
    <main className="app-shell">
      <div className="app-frame telemetry-page-frame">
        <header className="app-header compact-header">
          <div className="brand-block"><div className="brand-mark"><span /></div><div><div className="brand-kicker">RACING ANALYTICS</div><h1>Telemetry Lab</h1><p>Análise técnica da semana ativa</p></div></div>
        </header>
        <AppTabs />
        <ActiveWeekTelemetry />
      </div>
    </main>
  );
}
