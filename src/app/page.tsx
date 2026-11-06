import { AppShell } from "@/components/AppShell";
import { currentTenant, requireUser } from "@/lib/request";

export default async function WorkspacePage() {
  const tenant = await currentTenant();
  const user = await requireUser();
  return (
    <AppShell tenant={tenant} user={user} current="projects">
      <div className="page-head">
        <div>
          <div className="eyebrow">{tenant.branding.displayName} · Workspace</div>
          <h1>Projects</h1>
        </div>
      </div>
      <div className="split">
        <section className="main">
          <div className="empty stack">
            <h2 style={{ fontSize: 24, fontWeight: 700 }}>No projects yet</h2>
            <p className="muted" style={{ margin: 0 }}>
              Projects hold an agreed scope baseline and every change made to it. Creating a project and importing its
              agreed scope arrives in the next build slice.
            </p>
          </div>
        </section>
        <aside className="side panel stack">
          <div className="eyebrow">How a change moves</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
            <li>
              <strong>Agree</strong> a versioned scope baseline
            </li>
            <li>
              <strong>Capture</strong> each change request against it
            </li>
            <li>
              <strong>Assess</strong> the impact; AI suggests, people decide
            </li>
            <li>
              <strong>Decide</strong>: the client approves the exact version
            </li>
          </ol>
        </aside>
      </div>
    </AppShell>
  );
}
