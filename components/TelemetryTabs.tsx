"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RaceDebriefView from "@/components/telemetry/RaceDebriefView";
import CarCompareView from "@/components/telemetry/CarCompareView";
import TrainingPlan from "@/components/telemetry/TrainingPlan";
import { PageTitle, SegmentedControl } from "@/components/ui";
import { trackUiEvent } from "@/lib/track-ui-event";

type Mode = "debrief" | "cars" | "plan";

// Redesign etapa 4 (26/09/2026) + 17/11/2026: "Semana ativa" foi movida para a Visão Geral (/),
// deixando Telemetry Lab focado em Race Debrief, Comparação de carros e Plano e volta.
const OPTIONS = [
  { value: "debrief" as const, label: "Race Debrief" },
  { value: "cars" as const, label: "Comparação de carros" },
  { value: "plan" as const, label: "Plano e volta" },
];
const TITLES: Record<Mode, { eyebrow: string; title: string }> = {
  debrief: { eyebrow: "Telemetry Lab · Race Debrief", title: "Debrief da corrida" },
  cars: { eyebrow: "Telemetry Lab · comparação", title: "Comparação de carros" },
  plan: { eyebrow: "Telemetry Lab · plano e volta", title: "Plano e volta" },
};

export default function TelemetryTabs() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("debrief");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "debrief" || tab === "cars" || tab === "plan") setMode(tab);
  }, []);
  const select = (value: Mode) => { setMode(value); trackUiEvent("telemetry_tab_selected", { tab: value }); };
  return (
    <>
      <PageTitle eyebrow={TITLES[mode].eyebrow} title={TITLES[mode].title}
        aside={<SegmentedControl options={OPTIONS} value={mode} ariaLabel="Área do Telemetry Lab" onChange={select} />} />
      {mode === "debrief" ? <RaceDebriefView onOpenReference={() => router.push("/")} /> : mode === "cars" ? <CarCompareView /> : <TrainingPlan />}
    </>
  );
}
