import { redirect } from "next/navigation";

export default function DebriefsPage() {
  redirect("/telemetry?tab=debrief");
}
