"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({ projectId, versionCount }: { projectId: string; versionCount: number }) {
  const path = usePathname();
  const tabs = [
    { href: `/projects/${projectId}/scope`, label: "Scope draft" },
    { href: `/projects/${projectId}/versions`, label: `Agreed versions (${versionCount})` },
  ];
  return (
    <nav className="tabs" aria-label="Project">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path.startsWith(t.href) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
