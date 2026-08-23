"use client";

import { useState } from "react";
import { Activity, Gauge } from "lucide-react";
import ActiveWeekTelemetry from "@/components/ActiveWeekTelemetry";
import RaceDebrief from "@/components/RaceDebrief";

export default function TelemetryTabs() {
  const [mode, setMode] = useState<"lap" | "debrief">("lap");
  return (
    <>
      <div className="setup-subtabs">
        <button className={mode === "lap" ? "active" : ""} onClick={() => setMode("lap")}><Gauge size={16} />Melhor volta vs referência</button>
        <button className={mode === "debrief" ? "active" : ""} onClick={() => setMode("debrief")}><Activity size={16} />Meu Debrief</button>
      </div>
      {mode === "lap" ? <ActiveWeekTelemetry /> : <RaceDebrief />}
    </>
  );
}
