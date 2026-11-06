import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { canManageProjects, listProjects } from "@/lib/projects";
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
            A project holds the scope agreed with a client and every change made to it. Start by creating one, then import
            the agreed scope from a spreadsheet.
          </p>
        </div>
      ) : (
        <div className="table-box">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Client</th>
                <th scope="col">Scope</th>
                <th scope="col">Agreed version</th>
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
                  <td>{p.itemCount} items</td>
                  <td>{p.latestVersion ? <span className="badge">v{p.latestVersion}</span> : <span className="muted">Not yet published</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
