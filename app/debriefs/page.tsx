import DebriefsView from "@/components/debriefs/DebriefsView";
import "../night-grid-debriefs.css";

export const metadata = { title: "Debriefs • Racing Analytics" };

/** Debriefs da season e da week (redesign etapa 5). Referências: docs/redesign-mockup/DebriefSeason.dc.html
 * e DebriefWeek.dc.html. `?scope=week|season` escolhe o recorte; `?segment=formula|gt3|imsa` a aba. */
export default async function DebriefsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const scope = params.scope === "week" ? "week" : "season";
  const segment = params.segment === "gt3" || params.segment === "imsa" ? params.segment : "formula";
  return <DebriefsView initialScope={scope} initialSegment={segment} />;
}
