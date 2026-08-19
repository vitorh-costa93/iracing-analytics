"use client";

import Link from "next/link";
import { Activity, Gauge, Wrench } from "lucide-react";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/telemetry", label: "Telemetria", icon: Activity },
  { href: "/setup", label: "Setup", icon: Wrench },
];

export default function AppTabs() {
  const pathname = usePathname();
  return (
    <nav className="app-tabs" aria-label="Áreas do Racing Analytics">
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={pathname === href ? "active" : ""}>
          <Icon size={15} aria-hidden />{label}
        </Link>
      ))}
    </nav>
  );
}
