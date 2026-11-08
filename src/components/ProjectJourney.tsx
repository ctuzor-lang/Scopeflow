import Link from "next/link";
import type { ProjectProgress } from "@/lib/projects";

type Step = { done: boolean; title: string; detail: string; href: string; action: string };

/**
 * The four steps every project goes through, shown until they're all done, so a new user
 * always knows what to do next. Later, it gives way to a one-line "needs attention" strip.
 */
export function ProjectJourney({ projectId, p, clientName }: { projectId: string; p: ProjectProgress; clientName: string }) {
  const base = `/projects/${projectId}`;
  const steps: Step[] = [
    {
      done: p.draftItems > 0 || p.versions > 0,
      title: "Add the agreed scope",
      detail: "Import it from a spreadsheet or add items one by one.",
      href: `${base}/scope`,
      action: "Add scope",
    },
    {
      done: p.versions > 0,
      title: "Publish version 1",
      detail: "Locks the scope you agreed. Every change is measured against it.",
      href: `${base}/scope#publish`,
      action: "Publish",
    },
    {
      done: p.approvers > 0,
      title: `Invite an approver at ${clientName}`,
      detail: "They review changes in their own portal. No password needed.",
      href: `${base}/clients`,
      action: "Invite",
    },
    {
      done: p.changes > 0,
      title: "Log the first change request",
      detail: "Record what was asked, assess it, then send it for a decision.",
      href: `${base}/changes#log`,
      action: "Log a change",
    },
  ];
  const next = steps.findIndex((s) => !s.done);

  if (next === -1) {
    const items = [
      p.toAssess ? { n: p.toAssess, text: `${p.toAssess === 1 ? "change" : "changes"} to assess`, href: `${base}/changes` } : null,
      p.awaitingClient ? { n: p.awaitingClient, text: "waiting for the client", href: `${base}/changes` } : null,
      p.toIncorporate ? { n: p.toIncorporate, text: "approved, to put into the agreed scope", href: `${base}/scope#publish` } : null,
    ].filter((x): x is { n: number; text: string; href: string } => x !== null);
    if (!items.length) return null;
    return (
      <div className="attention" role="status">
        <span className="eyebrow">Needs attention</span>
        {items.map((i) => (
          <Link key={i.text} href={i.href}>
            <strong>{i.n}</strong> {i.text}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <section className="journey" aria-label="Getting started">
      <div className="journey-head">
        <span className="eyebrow">Getting started · step {next + 1} of {steps.length}</span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "done" : i === next ? "current" : ""}>
            <span className="journey-dot" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
            <span className="journey-text">
              <strong>{s.title}</strong>
              <span className="hint">{s.done ? "Done" : s.detail}</span>
            </span>
            {i === next ? (
              <Link href={s.href} className="btn accent journey-cta">
                {s.action}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
