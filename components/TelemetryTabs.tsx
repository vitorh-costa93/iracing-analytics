"use client";

import { useState } from "react";
import { Activity, Gauge, LayoutGrid } from "lucide-react";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import RaceDebrief from "@/components/RaceDebrief";
import SectorConsistency from "@/components/SectorConsistency";

export default function TelemetryTabs() {
  const [mode, setMode] = useState<"lap" | "debrief" | "sectors">("lap");
  return (
    <>
      <div className="setup-subtabs">
        <button className={mode === "lap" ? "active" : ""} onClick={() => setMode("lap")}><Gauge size={16} />Melhor volta vs referência</button>
        <button className={mode === "debrief" ? "active" : ""} onClick={() => setMode("debrief")}><Activity size={16} />Meu Debrief</button>
        <button className={mode === "sectors" ? "active" : ""} onClick={() => setMode("sectors")}><LayoutGrid size={16} />Consistência por setor</button>
      </div>
      {mode === "lap" ? <ActiveWeekTelemetry /> : mode === "debrief" ? <RaceDebrief /> : <SectorConsistency />}
    </>
  );
}
