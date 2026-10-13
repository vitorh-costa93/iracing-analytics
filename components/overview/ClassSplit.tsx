"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import type { DebriefReport, DebriefSection } from "@/lib/debrief-types";
import { signedDec, signedInt } from "@/lib/debrief-narrative";
import "../../app/night-grid-debriefs.css";

/** Sports Car por classe (13/10/2026): GT3 (inclui GT Sprint) e IMSA lado a lado, season atual contra a anterior no mesmo
 * ponto. Reaproveita o /api/dashboard/report (cache de 120 s no servidor, o mesmo dos Debriefs): nenhuma consulta nova. */
const CLASSES = [
  { segment: "gt3", label: "GT3", note: "inclui GT Sprint e Regional Tour" },
  { segment: "imsa", label: "IMSA", note: "GTP: Ferrari 499P, Cadillac, Acura" },
] as const;
const tone = (value: number | null) => (value === null ? undefined : value > 0 ? "gain" : value < 0 ? "loss" : undefined);

export default function ClassSplit() {
  const [sections, setSections] = useState<Record<string, DebriefSection | null>>({});
  useEffect(() => {
    let dead = false;
    for (const item of CLASSES) {
      fetch("/api/dashboard/report?scope=season&segment=" + item.segment)
        .then((response) => (response.ok ? (response.json() as Promise<DebriefReport>) : null))
        .then((report) => { if (!dead) setSections((current) => ({ ...current, [item.segment]: report?.sections[0] ?? null })); })
        .catch(() => { if (!dead) setSections((current) => ({ ...current, [item.segment]: null })); });
    }
    return () => { dead = true; };
  }, []);
  const loaded = CLASSES.filter((item) => sections[item.segment]?.field?.now.races);
  if (!loaded.length) return null;
  const label = sections[loaded[0].segment]?.field?.referenceLabel ?? "season anterior";
  return (
    <section className="ngo-class-split" aria-label="Sports Car por classe">
      <Panel kicker="SPORTS CAR POR CLASSE" title={"GT3 e IMSA, cada um contra " + label} titleSize="sm"
        subtitle="O iRating é um só para o Sports Car; saldo, permanência e resultado vs esperado são por classe.">
        <div className="ngd-scroll-x">
          <table className="ngd-table">
            <thead>
              <tr><th rowSpan={2}>Classe</th><th className="grp" colSpan={4}>Agora</th><th className="grp sep" colSpan={4}>Mesmo ponto da anterior</th><th rowSpan={2} /></tr>
              <tr><th className="r">Corr.</th><th className="r">Saldo</th><th className="r">Perman.</th><th className="r">vs esp.</th><th className="r sep">Corr.</th><th className="r">Saldo</th><th className="r">Perman.</th><th className="r">vs esp.</th></tr>
            </thead>
            <tbody>
              {loaded.map((item) => {
                const field = sections[item.segment]!.field!;
                return (
                  <tr key={item.segment}>
                    <td><strong>{item.label}</strong><span className="sub">{item.note}</span></td>
                    <td className="r">{field.now.races}</td>
                    <td className="r" data-tone={tone(field.now.net)}>{signedInt(field.now.net)}</td>
                    <td className="r" data-tone={field.now.permanencePct !== null && field.now.permanencePct < 80 ? "loss" : undefined}>{field.now.permanencePct === null ? "—" : field.now.permanencePct + "%"}</td>
                    <td className="r" data-tone={tone(field.now.residualAvg)}>{field.now.residualAvg === null ? "—" : signedDec(field.now.residualAvg, 1)}</td>
                    <td className="r sep">{field.before.races}</td>
                    <td className="r" data-tone={field.before.races ? tone(field.before.net) : "muted"}>{field.before.races ? signedInt(field.before.net) : "—"}</td>
                    <td className="r">{field.before.permanencePct === null ? "—" : field.before.permanencePct + "%"}</td>
                    <td className="r" data-tone={tone(field.before.residualAvg)}>{field.before.residualAvg === null ? "—" : signedDec(field.before.residualAvg, 1)}</td>
                    <td className="r"><Link href={"/debriefs?scope=season&segment=" + item.segment}>Debrief →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
