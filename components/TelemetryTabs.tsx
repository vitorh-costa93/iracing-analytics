"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RaceDebriefView from "@/components/telemetry/RaceDebriefView";
import CarCompareView from "@/components/telemetry/CarCompareView";
import HistoryView from "@/components/telemetry/HistoryView";
import { PageTitle, SegmentedControl } from "@/components/ui";
import { trackUiEvent } from "@/lib/track-ui-event";

type Mode = "debrief" | "cars" | "history";

const OPTIONS = [
  { value: "debrief" as const, label: "Race Debrief" },
  { value: "cars" as const, label: "Comparação de carros" },
  { value: "history" as const, label: "Histórico" },
];
const TITLES: Record<Mode, { eyebrow: string; title: string }> = {
  debrief: { eyebrow: "Deep Dive · Race Debrief", title: "Debrief da corrida" },
  cars: { eyebrow: "Deep Dive · comparação", title: "Comparação de carros" },
  history: { eyebrow: "Deep Dive · histórico", title: "Histórico de performance" },
};

export default function TelemetryTabs() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("debrief");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "debrief" || tab === "cars" || tab === "history") setMode(tab);
  }, []);
  const select = (value: Mode) => { setMode(value); trackUiEvent("telemetry_tab_selected", { tab: value }); };
  return (
    <>
      <PageTitle eyebrow={TITLES[mode].eyebrow} title={TITLES[mode].title}
        aside={<SegmentedControl options={OPTIONS} value={mode} ariaLabel="Área do Deep Dive" onChange={select} />} />
      {mode === "debrief" ? <RaceDebriefView onOpenReference={() => router.push("/")} /> : mode === "cars" ? <CarCompareView /> : <HistoryView />}
    </>
  );
}
