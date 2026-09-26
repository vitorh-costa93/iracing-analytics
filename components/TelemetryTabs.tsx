"use client";

import { useState } from "react";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import RaceDebrief from "@/components/RaceDebrief";
import CarComparison from "@/components/CarComparison";
import { PageTitle, SegmentedControl } from "@/components/ui";
import { trackUiEvent } from "@/lib/track-ui-event";

type Mode = "lap" | "debrief" | "cars";

// Redesign etapa 3 (25/09/2026): título e seletor do Telemetry.dc.html. "Race Debrief" e
// "Comparação de carros" continuam com a UI atual até a etapa 4.
const OPTIONS = [
  { value: "lap" as const, label: "Semana ativa" },
  { value: "debrief" as const, label: "Race Debrief" },
  { value: "cars" as const, label: "Comparação de carros" },
];
const TITLES: Record<Mode, { eyebrow: string; title: string }> = {
  lap: { eyebrow: "Telemetry Lab · semana ativa", title: "Telemetria da semana" },
  debrief: { eyebrow: "Telemetry Lab · race debrief", title: "Race Debrief" },
  cars: { eyebrow: "Telemetry Lab · comparação", title: "Comparação de carros" },
};

export default function TelemetryTabs() {
  const [mode, setMode] = useState<Mode>("lap");
  return (
    <>
      <PageTitle eyebrow={TITLES[mode].eyebrow} title={TITLES[mode].title}
        aside={<SegmentedControl options={OPTIONS} value={mode} ariaLabel="Área do Telemetry Lab" onChange={(value) => { setMode(value); trackUiEvent("telemetry_tab_selected", { tab: value }); }} />} />
      {mode === "lap" ? <ActiveWeekTelemetry /> : mode === "debrief" ? <div className="ngt-legacy"><RaceDebrief /></div> : <div className="ngt-legacy"><CarComparison /></div>}
    </>
  );
}
