import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { ItemFields, kindLabel } from "@/components/ItemFields";
import { changesAwaitingIncorporation, diffSize, draftChanges } from "@/lib/baselines";
import { crRef } from "@/lib/changes";
import { canPublish, getProject } from "@/lib/projects";
import { currentTenant, requireUser } from "@/lib/request";
import { plural } from "@/lib/format";
import { draftItems, type DraftItem } from "@/lib/scope";
import { addItemAction, importScopeAction, publishAction, removeItemAction } from "../../actions";

function groupBySection(items: DraftItem[]) {
  const groups = new Map<string, DraftItem[]>();
  for (const i of items) {
    const k = i.section ?? "General";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.entries()];
}

export default async function ScopePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const tenant = await currentTenant();
  const user = await requireUser();
  const project = await getProject(tenant.id, projectId);
  if (!project) notFound();
  const [items, changes, approved] = await Promise.all([
    draftItems(tenant.id, projectId),
    draftChanges(tenant.id, projectId),
    changesAwaitingIncorporation(tenant.id, projectId),
  ]);
  const pending = diffSize(changes.diff);
  const nextVersion = (changes.latest?.version ?? 0) + 1;

  return (
    <div className="split">
      <section className="main">
        <div className="stat-row" style={{ marginBottom: 16 }}>
          <span>
            <strong>{items.length}</strong> {items.length === 1 ? "item" : "items"} in the draft
          </span>
          {changes.latest ? (
            <span className="muted">
              {pending === 0
                ? `Same as agreed version ${changes.latest.version}`
                : `${changes.diff.added.length} added, ${changes.diff.changed.length} changed, ${changes.diff.removed.length} removed since version ${changes.latest.version}`}
            </span>
          ) : (
            <span className="muted">Not yet published</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="empty stack">
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>The draft is empty</h2>
            <p className="muted" style={{ margin: 0 }}>
              Import the agreed scope from a spreadsheet, or add items one at a time. Nothing is shared with the client until
              you publish it.
            </p>
          </div>
        ) : (
          groupBySection(items).map(([section, group]) => (
            <div key={section}>
              <h2 className="section-title">{section}</h2>
              <div className="table-box">
                <table className="table stack-mobile">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 110 }}>Ref</th>
                      <th scope="col">Item</th>
                      <th scope="col" style={{ width: 130 }}>Type</th>
                      <th scope="col" style={{ width: 130 }}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((i) => (
                      <tr key={i.id}>
                        <td className="mono">{i.key}</td>
                        <td>
                          <Link href={`/projects/${projectId}/scope/items/${i.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>
                            {i.title}
                          </Link>
                          {i.description ? <div className="muted" style={{ fontSize: 14 }}>{i.description}</div> : null}
                          {i.acceptanceCriteria ? (
                            <div style={{ fontSize: 14, marginTop: 4 }}>
                              <span className="diff-label muted">Done when </span>
                              {i.acceptanceCriteria}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={`badge kind-${i.kind}`}>{kindLabel(i.kind)}</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                            <Link href={`/projects/${projectId}/scope/items/${i.id}`} className="linkbtn" aria-label={`Edit ${i.key}`}>
                              Edit
                            </Link>
                            <form action={removeItemAction.bind(null, projectId, i.id)}>
                              <button type="submit" className="linkbtn" aria-label={`Remove ${i.key} from the draft`}>
                                Remove
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <aside className="side stack">
        {canPublish(user.role) && items.length > 0 ? (
          <div className="panel stack" id="publish">
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>
              {pending === 0 && approved.length === 0 && changes.latest ? `Version ${changes.latest.version} is up to date` : `Publish version ${nextVersion}`}
            </h2>
            {pending === 0 && approved.length === 0 && changes.latest ? (
              <p className="muted" style={{ margin: 0, fontSize: 15 }}>
                The draft matches agreed version {changes.latest.version}. When an approved change needs adding, edit the
                draft here and publish a new version.
              </p>
            ) : (
              <>
                <p className="muted" style={{ margin: 0, fontSize: 15 }}>
                  {changes.latest
                    ? `Locks the draft as version ${nextVersion}, replacing version ${changes.latest.version} as the agreed scope. Earlier versions stay on record.`
                    : "Locks the draft as version 1: the scope you and the client agreed. Every change request is measured against it."}{" "}
                  A published version can&apos;t be edited.
                </p>
                <ActionForm action={publishAction.bind(null, projectId)} submitLabel={`Publish version ${nextVersion}`} pendingLabel="Publishing…" buttonClass="btn accent">
                  {approved.length ? (
                    <fieldset>
                      <legend>Approved changes this version puts into effect</legend>
                      {approved.map((c) => (
                        <label key={c.number} className="check">
                          <input type="checkbox" name="includes" value={c.number} defaultChecked />
                          <span>
                            <span className="mono">{crRef(c.number)}</span> {c.title}
                          </span>
                        </label>
                      ))}
                      <span className="hint">Untick any change the draft doesn&apos;t reflect yet.</span>
                    </fieldset>
                  ) : null}
                  <label className="check">
                    <input type="checkbox" name="confirm" />
                    <span>
                      I&apos;ve checked the draft and it matches what was agreed
                      {changes.latest ? ` (${plural(pending, "change")} since version ${changes.latest.version})` : ""}.
                    </span>
                  </label>
                </ActionForm>
              </>
            )}
          </div>
        ) : null}

        <Disclosure title="Import from a spreadsheet" defaultOpen={items.length === 0}>
          <div className="stack">
            <p className="muted" style={{ margin: 0, fontSize: 15 }}>
              Excel (.xlsx) or CSV. The first row must name the columns; only a <strong>Title</strong> column is required.
              Ref, Section, Type, Description and Acceptance criteria are picked up if present. Rows whose Ref already exists
              update that item.
            </p>
            <a href="/projects/template.csv" className="hint" download>
              Download a template (CSV)
            </a>
            <ActionForm action={importScopeAction.bind(null, projectId)} submitLabel="Import into draft" pendingLabel="Importing…" resetOnSuccess>
              <label>
                Spreadsheet
                <input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              </label>
            </ActionForm>
          </div>
        </Disclosure>

        <Disclosure title="Add an item">
          <ActionForm action={addItemAction.bind(null, projectId)} submitLabel="Add to draft" pendingLabel="Adding…" resetOnSuccess>
            <ItemFields />
          </ActionForm>
        </Disclosure>
      </aside>
    </div>
  );
}
