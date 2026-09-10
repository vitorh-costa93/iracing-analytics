"use client";

import { useState } from "react";
import { Activity, Gauge, GitCompare } from "lucide-react";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import RaceDebrief from "@/components/RaceDebrief";
import CarComparison from "@/components/CarComparison";
import { trackUiEvent } from "@/lib/track-ui-event";

export default function TelemetryTabs() {
  const [mode, setMode] = useState<"lap" | "debrief" | "cars">("lap");
  return (
    <>
      <div className="setup-subtabs">
        <button className={mode === "lap" ? "active" : ""} onClick={() => { setMode("lap"); trackUiEvent("telemetry_tab_selected", { tab: "lap" }); }}><Gauge size={16} />Melhor volta vs referência</button>
        <button className={mode === "debrief" ? "active" : ""} onClick={() => { setMode("debrief"); trackUiEvent("telemetry_tab_selected", { tab: "debrief" }); }}><Activity size={16} />Meu Debrief</button>
        <button className={mode === "cars" ? "active" : ""} onClick={() => { setMode("cars"); trackUiEvent("telemetry_tab_selected", { tab: "cars" }); }}><GitCompare size={16} />Comparar carros</button>
      </div>
      {mode === "lap" ? <ActiveWeekTelemetry /> : mode === "debrief" ? <RaceDebrief /> : <CarComparison />}
    </>
  );
}
