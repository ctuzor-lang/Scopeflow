import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { canManageProjects, listProjects } from "@/lib/projects";
import { plural } from "@/lib/format";
import { currentTenant, requireUser } from "@/lib/request";

export default async function WorkspacePage() {
  const tenant = await currentTenant();
  const user = await requireUser();
  const projects = await listProjects(tenant.id);
  return (
    <AppShell tenant={tenant} user={user} current="projects">
      <div className="page-head">
        <div>
          <div className="eyebrow">{tenant.branding.displayName} · Workspace</div>
          <h1>Projects</h1>
        </div>
        {canManageProjects(user.role) ? (
          <Link href="/projects/new" className="btn solid">
            New project
          </Link>
        ) : null}
      </div>
      {projects.length === 0 ? (
        <div className="empty stack">
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>No projects yet</h2>
          <p className="muted" style={{ margin: 0 }}>
            A project holds the scope agreed with a client and every change made to it. Create one, add the agreed scope,
            invite the client&apos;s approver, and you&apos;re ready to log changes.
          </p>
          {canManageProjects(user.role) ? (
            <div>
              <Link href="/projects/new" className="btn accent">
                Create your first project
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="table-box">
          <table className="table stack-mobile">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Client</th>
                <th scope="col">Scope</th>
                <th scope="col">Agreed version</th>
                <th scope="col">Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}/scope`} style={{ fontWeight: 600 }}>
                      {p.name}
                    </Link>
                    {p.reference ? <div className="hint">{p.reference}</div> : null}
                  </td>
                  <td>{p.clientName}</td>
                  <td>{plural(p.itemCount, "item")}</td>
                  <td>{p.latestVersion ? <span className="badge">v{p.latestVersion}</span> : <span className="muted">Not yet published</span>}</td>
                  <td>
                    {p.attention.toAssess + p.attention.awaitingClient + p.attention.toIncorporate === 0 ? (
                      <span className="muted">Nothing</span>
                    ) : (
                      <Link href={`/projects/${p.id}/changes`} style={{ textDecoration: "none", display: "grid", fontSize: 14 }}>
                        {p.attention.toAssess ? <span>{plural(p.attention.toAssess, "change")} to assess</span> : null}
                        {p.attention.awaitingClient ? <span className="muted">{p.attention.awaitingClient} with the client</span> : null}
                        {p.attention.toIncorporate ? <span>{p.attention.toIncorporate} to put into scope</span> : null}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
