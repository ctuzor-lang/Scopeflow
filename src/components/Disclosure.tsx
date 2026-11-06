"use client";

import { useState, type ReactNode } from "react";

/** A collapsible panel that remembers whether the user opened it, even when the page data refreshes. */
export function Disclosure({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="panel" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
