import TelemetryTabs from "@/components/TelemetryTabs";
import "../night-grid-overview.css";
import "../night-grid-telemetry.css";
import "../night-grid-debrief.css";

export const metadata = { title: "Deep Dive • Racing Analytics" };

// Redesign etapa 3 (25/09/2026): superfície Night Grid (Telemetry.dc.html). A frescura das fontes
// e o "Atualizar dados" ficam no cabeçalho global (components/AppHeader.tsx).
export default function TelemetryPage() {
  return (
    <div className="ng-page">
      <main className="ng-main">
        <TelemetryTabs />
      </main>
    </div>
  );
}
