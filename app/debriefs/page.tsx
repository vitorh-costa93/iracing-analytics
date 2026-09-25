import Link from "next/link";
import { Chip, PageTitle, Panel } from "@/components/ui";

export const metadata = { title: "Debriefs • Racing Analytics" };

/** Placeholder da área Debriefs (redesign etapa 1). Os debriefs de season e de week
 * (docs/redesign-mockup/DebriefSeason.dc.html e DebriefWeek.dc.html) chegam na etapa 5; até lá o
 * debrief de corrida continua no Telemetry Lab. */
export default function DebriefsPage() {
  return (
    <div className="ng-page">
      <main className="ng-main">
        <PageTitle eyebrow="Race Engineer" title="Debriefs" aside={<Chip>em construção</Chip>} />
        <Panel kicker="Em breve" title="Debrief da season e da week" titleSize="md" subtitle="Leitura rápida, ritmo × resultado, quando as perdas acontecem e as corridas de maior impacto.">
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--ng-text-2)", maxWidth: 720 }}>
            Esta área ainda está sendo montada. O debrief de uma corrida específica continua disponível no{" "}
            <Link href="/telemetry" style={{ color: "var(--ng-text)", textDecoration: "underline" }}>Telemetry Lab</Link>, na aba Meu Debrief.
          </p>
        </Panel>
      </main>
    </div>
  );
}
