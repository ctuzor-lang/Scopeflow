import { ActionForm } from "@/components/ActionForm";
import { listClientAccess } from "@/lib/clients";
import { canPublish } from "@/lib/projects";
import { currentTenant, requireUser } from "@/lib/request";
import { inviteClientAction, revokeClientAction } from "../../changes-actions";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(d);

export default async function ClientAccessPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const tenant = await currentTenant();
  const user = await requireUser();
  const access = await listClientAccess(tenant.id, projectId);
  const manage = canPublish(user.role);

  return (
    <div className="split">
      <section className="main stack">
        <p className="muted" style={{ margin: 0 }}>
          Client people see only this project, through {tenant.branding.displayName}&apos;s branded portal. They sign in with a
          one-time code sent to their email; there&apos;s no password and no access to your workspace.
        </p>
        {access.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0 }}>No client access yet. Add the person who will approve changes.</p>
          </div>
        ) : (
          <div className="table-box">
            <table className="table stack-mobile">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Can</th>
                  <th scope="col">Since</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {access.map((a) => (
                  <tr key={a.id} style={a.status === "revoked" ? { color: "var(--muted)" } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name ?? a.email}</div>
                      <div className="hint">{a.email}</div>
                    </td>
                    <td>{a.status === "revoked" ? "Access removed" : a.role === "approver" ? "Approve or decline changes" : "View and ask questions"}</td>
                    <td>{fmt(a.invitedAt)}</td>
                    <td>
                      {manage && a.status === "active" ? (
                        <form action={revokeClientAction.bind(null, projectId, a.id)}>
                          <button type="submit" className="linkbtn" aria-label={`Remove access for ${a.email}`}>
                            Remove access
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {manage ? (
        <aside className="side panel stack">
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Give someone access</h2>
          {tenant.sandbox ? (
            <p className="hint" style={{ margin: 0 }}>Demo: nobody is emailed, and any address you type is replaced with a made-up one.</p>
          ) : null}
          <ActionForm action={inviteClientAction.bind(null, projectId)} submitLabel="Give access and email them" pendingLabel="Sending…" resetOnSuccess>
            <label>
              Name
              <input type="text" name="name" required maxLength={120} placeholder="Jas Patel" />
            </label>
            <label>
              Work email
              <input type="email" name="email" required maxLength={254} placeholder="jas.patel@northwind.example" />
            </label>
            <label>
              They can
              <select name="role" defaultValue="approver">
                <option value="approver">Approve or decline changes</option>
                <option value="viewer">View and ask questions only</option>
              </select>
            </label>
          </ActionForm>
        </aside>
      ) : null}
    </div>
  );
}
