"use client";

import { useState } from "react";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import RaceDebriefView from "@/components/telemetry/RaceDebriefView";
import CarCompareView from "@/components/telemetry/CarCompareView";
import { PageTitle, SegmentedControl } from "@/components/ui";
import { trackUiEvent } from "@/lib/track-ui-event";

type Mode = "lap" | "debrief" | "cars";

// Redesign etapa 3 (25/09/2026): título e seletor do Telemetry.dc.html. Etapa 4 (26/09/2026): Race
// Debrief (Debrief.dc.html) e Comparação de carros (Compare.dc.html) no Night Grid. Os componentes
// antigos (RaceDebrief, CarComparison, SectorConsistency) ficam no repositório, fora desta tela.
const OPTIONS = [
  { value: "lap" as const, label: "Semana ativa" },
  { value: "debrief" as const, label: "Race Debrief" },
  { value: "cars" as const, label: "Comparação de carros" },
];
const TITLES: Record<Mode, { eyebrow: string; title: string }> = {
  lap: { eyebrow: "Telemetry Lab · semana ativa", title: "Telemetria da semana" },
  debrief: { eyebrow: "Telemetry Lab · Race Debrief", title: "Debrief da corrida" },
  cars: { eyebrow: "Telemetry Lab · comparação", title: "Comparação de carros" },
};

export default function TelemetryTabs() {
  const [mode, setMode] = useState<Mode>("lap");
  const select = (value: Mode) => { setMode(value); trackUiEvent("telemetry_tab_selected", { tab: value }); };
  return (
    <>
      <PageTitle eyebrow={TITLES[mode].eyebrow} title={TITLES[mode].title}
        aside={<SegmentedControl options={OPTIONS} value={mode} ariaLabel="Área do Telemetry Lab" onChange={select} />} />
      {mode === "lap" ? <ActiveWeekTelemetry /> : mode === "debrief" ? <RaceDebriefView onOpenReference={() => select("lap")} /> : <CarCompareView />}
    </>
  );
}
