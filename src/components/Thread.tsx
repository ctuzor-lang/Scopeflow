import type { Comment } from "@/lib/decisions";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(d);

/** Questions and answers on a change, labelled by side so it's clear who said what. */
export function Thread({ comments, agencyName }: { comments: Comment[]; agencyName: string }) {
  if (comments.length === 0) return <p className="muted" style={{ margin: 0 }}>No questions yet.</p>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
      {comments.map((c) => (
        <li key={c.id} style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "12px 14px", borderLeft: c.side === "agency" ? "3px solid var(--accent)" : "3px solid var(--ink)" }}>
          <div className="hint">
            <strong style={{ color: "var(--ink)" }}>{c.author}</strong> · {c.side === "agency" ? agencyName : "Client"} · {fmt(c.createdAt)}
          </div>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{c.body}</p>
        </li>
      ))}
    </ol>
  );
}
