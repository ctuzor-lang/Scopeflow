import Link from "next/link";
import { PortalShell } from "@/components/PortalShell";
import { CLIENT_STATUS_LABEL, crRef, type CrStatus } from "@/lib/changes";
import { clientProjects } from "@/lib/clients";
import { currentTenant, requireClient } from "@/lib/request";

export default async function PortalHome() {
  const tenant = await currentTenant();
  const user = await requireClient();
  const rows = await clientProjects(tenant.id, user.userId);
  const projects = new Map<string, { name: string; role: string; changes: typeof rows }>();
  for (const r of rows) {
    const p = projects.get(r.project_id) ?? { name: r.project_name, role: r.role, changes: [] };
    if (r.number !== null) p.changes.push(r);
    // Decisions waiting come first.
    p.changes.sort((a, b) => Number(b.status === "awaiting_client") - Number(a.status === "awaiting_client"));
    projects.set(r.project_id, p);
  }
  const waiting = rows.filter((r) => r.status === "awaiting_client").length;

  return (
    <PortalShell tenant={tenant} who={user.displayName ?? user.email}>
      <div className="eyebrow">{tenant.branding.displayName}</div>
      <h1 style={{ fontSize: 36, fontWeight: 800, margin: "8px 0 8px" }}>
        {waiting ? `${waiting} ${waiting === 1 ? "decision" : "decisions"} waiting` : "You're all caught up"}
      </h1>
      <p className="muted" style={{ margin: "0 0 16px" }}>
        Proposed changes to your projects&apos; agreed scope, with what each would cost and how it affects the timeline.
      </p>
      <ol className="how" aria-label="How it works">
        <li><strong>Review</strong> what changes, the cost and the effect on the timeline.</li>
        <li><strong>Ask</strong> {tenant.branding.displayName} questions if anything is unclear.</li>
        <li><strong>Decide.</strong> Approve or decline; you both get the same signed record (PDF).</li>
      </ol>
      {[...projects.entries()].map(([id, p]) => (
        <section key={id} style={{ marginBottom: 28 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {p.name}
          </h2>
          {p.changes.length === 0 ? (
            <p className="muted">Nothing to review yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--line)", background: "var(--paper)" }}>
              {p.changes.map((c) => (
                <li key={c.number} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Link
                    href={`/portal/changes/${id}/${c.number}`}
                    style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "14px 16px", textDecoration: "none", minHeight: 56 }}
                  >
                    <span>
                      <span className="mono muted">{crRef(c.number!)}</span>
                      <span style={{ display: "block", fontWeight: 600 }}>{c.title}</span>
                      {c.status === "awaiting_client" ? <span className="next-step act">Review and decide →</span> : null}
                    </span>
                    <span className={`status status-${c.status}`}>{CLIENT_STATUS_LABEL[c.status as CrStatus]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </PortalShell>
  );
}
