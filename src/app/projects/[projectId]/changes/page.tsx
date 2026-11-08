import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { listBaselines } from "@/lib/baselines";
import { STATUS_LABEL, formatMoney, listChangeRequests } from "@/lib/changes";
import { currentTenant, requireUser } from "@/lib/request";
import { raiseChangeAction } from "../../changes-actions";

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(d);

function RaiseForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={raiseChangeAction.bind(null, projectId)} submitLabel="Log change request" pendingLabel="Logging…">
      <label>
        Short title
        <input type="text" name="title" required maxLength={200} placeholder="Split-tender payment at checkout" />
      </label>
      <label>
        What the client asked for
        <textarea name="requestText" required maxLength={10000} placeholder="Paste or summarise the request in the client's words" />
      </label>
      <div className="grid-2">
        <label>
          Where it came from
          <select name="source" defaultValue="email">
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="call">Call</option>
            <option value="document">Document</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Requested by <span className="hint">(optional)</span>
          <input type="text" name="requestedBy" maxLength={160} placeholder="J. Patel, Head of Digital" />
        </label>
        <label>
          Date requested <span className="hint">(optional)</span>
          <input type="date" name="requestedOn" />
        </label>
        <label>
          Wanted by <span className="hint">(optional)</span>
          <input type="date" name="wantedBy" />
        </label>
      </div>
    </ActionForm>
  );
}

export default async function ChangesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const tenant = await currentTenant();
  // Pages render alongside their layout, so each page must check access itself (security review F1).
  await requireUser();
  const [changes, versions] = await Promise.all([listChangeRequests(tenant.id, projectId), listBaselines(tenant.id, projectId)]);
  const latest = versions[0];

  return (
    <div className="split">
      <section className="main">
        {changes.length === 0 ? (
          <div className="empty stack">
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>No change requests yet</h2>
            <p className="muted" style={{ margin: 0 }}>
              Log every request that would alter the agreed scope, however small, as soon as it arrives. Each one is assessed
              against the agreed version before the client decides.
            </p>
          </div>
        ) : (
          <div className="table-box">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 90 }}>Ref</th>
                  <th scope="col">Change</th>
                  <th scope="col">Impact</th>
                  <th scope="col" style={{ width: 150 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.ref}</td>
                    <td>
                      <Link href={`/projects/${projectId}/changes/${c.number}`} style={{ fontWeight: 600 }}>
                        {c.title}
                      </Link>
                      <div className="hint">
                        Logged {fmtDate(c.createdAt)} against version {c.sourceVersion}
                        {c.requestedBy ? ` · from ${c.requestedBy}` : ""}
                      </div>
                    </td>
                    <td>
                      {c.latest ? (
                        <>
                          {c.latest.price.basis === "no_charge" ? "No charge" : formatMoney(c.latest.price.amountMinor, c.latest.price.currency)}
                          <div className="hint">
                            {c.latest.effort.minDays}–{c.latest.effort.maxDays} days · R{c.latestRev}
                          </div>
                        </>
                      ) : (
                        <span className="muted">Not assessed</span>
                      )}
                    </td>
                    <td>
                      <span className={`status status-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="side stack">
        {latest ? (
          <Disclosure title="Log a change request" defaultOpen={changes.length === 0}>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 15 }}>
              It will be assessed against version {latest.version}, the latest agreed scope.
            </p>
            <RaiseForm projectId={projectId} />
          </Disclosure>
        ) : (
          <div className="panel">
            <p style={{ margin: 0 }}>
              Publish the agreed scope first. Every change is raised against a numbered version, so it&apos;s always clear what
              it changes. <Link href={`/projects/${projectId}/scope`}>Go to the scope draft</Link>.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
