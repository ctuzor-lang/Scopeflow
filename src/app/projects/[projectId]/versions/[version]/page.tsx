import Link from "next/link";
import { notFound } from "next/navigation";
import { kindLabel } from "@/components/ItemFields";
import { baselineItems, changesInBaseline, diffItems, getBaseline, verifyBaseline, type ItemPayload } from "@/lib/baselines";
import { crRef } from "@/lib/changes";
import { currentTenant, requireUser } from "@/lib/request";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(d);

function ItemRow({ i, note, before }: { i: ItemPayload; note?: string; before?: ItemPayload }) {
  return (
    <tr>
      <td className="mono">{i.key}</td>
      <td>
        <div style={{ fontWeight: 600 }}>
          {note ? <span className="diff-label muted">{note} · </span> : null}
          {i.title}
        </div>
        {i.description ? <div className="muted" style={{ fontSize: 14 }}>{i.description}</div> : null}
        {i.acceptanceCriteria ? (
          <div style={{ fontSize: 14, marginTop: 4 }}>
            <span className="diff-label muted">Done when </span>
            {i.acceptanceCriteria}
          </div>
        ) : null}
        {before ? <WasLine before={before} after={i} /> : null}
      </td>
      <td>
        <span className={`badge kind-${i.kind}`}>{kindLabel(i.kind)}</span>
      </td>
    </tr>
  );
}

/** For a changed item, shows each field's previous wording. */
function WasLine({ before, after }: { before: ItemPayload; after: ItemPayload }) {
  const fields: [keyof ItemPayload, string][] = [
    ["title", "Title"],
    ["description", "Description"],
    ["acceptanceCriteria", "Done when"],
    ["section", "Section"],
    ["kind", "Type"],
  ];
  const changed = fields.filter(([f]) => (before[f] ?? null) !== (after[f] ?? null));
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)", fontSize: 14 }}>
      {changed.map(([f, label]) => (
        <div key={f} className="muted">
          <span className="diff-label">Was ({label}) </span>
          {before[f] ? <del>{String(f === "kind" ? kindLabel(String(before[f])) : before[f])}</del> : <em>empty</em>}
        </div>
      ))}
    </div>
  );
}

function ItemTable({ items }: { items: { i: ItemPayload; note?: string; before?: ItemPayload }[] }) {
  return (
    <div className="table-box">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" style={{ width: 110 }}>Ref</th>
            <th scope="col">Item</th>
            <th scope="col" style={{ width: 130 }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ i, note, before }) => (
            <ItemRow key={`${note ?? ""}${i.key}`} i={i} note={note} before={before} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function VersionPage({ params }: { params: Promise<{ projectId: string; version: string }> }) {
  const { projectId, version } = await params;
  const tenant = await currentTenant();
  // Pages render alongside their layout, so each page must check access itself (security review F1).
  await requireUser();
  const n = Number(version);
  const baseline = await getBaseline(tenant.id, projectId, n);
  if (!baseline) notFound();
  const [items, intact, previous, includes] = await Promise.all([
    baselineItems(baseline.id),
    verifyBaseline(tenant.id, projectId, n),
    n > 1 ? getBaseline(tenant.id, projectId, n - 1) : Promise.resolve(null),
    getBaseline(tenant.id, projectId, n).then((b) => (b ? changesInBaseline(b.id) : [])),
  ]);
  const diff = previous ? diffItems(await baselineItems(previous.id), items) : null;

  const sections = new Map<string, ItemPayload[]>();
  for (const i of items) sections.set(i.section ?? "General", [...(sections.get(i.section ?? "General") ?? []), i]);

  return (
    <div className="split">
      <section className="main">
        <h2 style={{ fontSize: 28, fontWeight: 800 }}>Version {baseline.version}</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Published {fmt(baseline.publishedAt)} by {baseline.publishedBy ?? "unknown"} · {baseline.itemCount} items
        </p>
        {includes.length ? (
          <p style={{ margin: "10px 0 0" }}>
            <span className="diff-label muted">Puts into effect </span>
            {includes.map((c, i) => (
              <span key={c.number}>
                {i ? ", " : ""}
                <Link href={`/projects/${projectId}/changes/${c.number}`}>
                  {crRef(c.number)} {c.title}
                </Link>
              </span>
            ))}
          </p>
        ) : null}

        {diff ? (
          <>
            <h3 className="section-title">Changes from version {n - 1}</h3>
            {diff.added.length + diff.changed.length + diff.removed.length === 0 ? (
              <p className="muted">No changes.</p>
            ) : (
              <ItemTable
                items={[
                  ...diff.added.map((i) => ({ i, note: "Added" })),
                  ...diff.changed.map((c) => ({ i: c.after, note: "Changed", before: c.before })),
                  ...diff.removed.map((i) => ({ i, note: "Removed" })),
                ]}
              />
            )}
          </>
        ) : null}

        {[...sections.entries()].map(([section, group]) => (
          <div key={section}>
            <h3 className="section-title">{section}</h3>
            <ItemTable items={group.map((i) => ({ i }))} />
          </div>
        ))}
      </section>
      <aside className="side stack">
        <div className="panel stack">
          <div className="eyebrow">Integrity</div>
          <p style={{ margin: 0 }}>
            <strong>{intact ? "Verified" : "Does not match"}</strong>
            {intact
              ? ": the content is exactly as published."
              : ": the stored content no longer matches its fingerprint. Contact support."}
          </p>
          <div>
            <div className="hint">Fingerprint (SHA-256)</div>
            <div className="mono" style={{ overflowWrap: "anywhere" }}>
              {baseline.digest.slice(7)}
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Any change to any item, however small, would produce a different fingerprint.
          </p>
        </div>
        <Link href={`/projects/${projectId}/versions`} className="hint">
          ← All versions
        </Link>
      </aside>
    </div>
  );
}
