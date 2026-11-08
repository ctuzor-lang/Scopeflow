import Link from "next/link";
import { listBaselines } from "@/lib/baselines";
import { currentTenant, requireUser } from "@/lib/request";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(d);

export default async function VersionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const tenant = await currentTenant();
  // Pages render alongside their layout, so each page must check access itself (security review F1).
  await requireUser();
  const versions = await listBaselines(tenant.id, projectId);
  if (versions.length === 0) {
    return (
      <div className="empty stack">
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>No versions published yet</h2>
        <p className="muted" style={{ margin: 0 }}>
          When the draft matches what was agreed, publish it from the{" "}
          <Link href={`/projects/${projectId}/scope`}>scope draft</Link>. Each published version is locked and numbered.
        </p>
      </div>
    );
  }
  return (
    <div className="table-box">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Items</th>
            <th scope="col">Published</th>
            <th scope="col">Fingerprint</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>
                <Link href={`/projects/${projectId}/versions/${v.version}`} style={{ fontWeight: 600 }}>
                  Version {v.version}
                </Link>
              </td>
              <td>{v.itemCount}</td>
              <td>
                {fmt(v.publishedAt)}
                <div className="hint">{v.publishedBy ?? "Unknown"}</div>
              </td>
              <td className="mono">{v.digest.slice(7, 19)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
