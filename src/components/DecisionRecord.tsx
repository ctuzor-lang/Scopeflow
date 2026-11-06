import type { Decision } from "@/lib/decisions";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(d);

/** The client's decision as recorded: who, when, which revision, and the exact words confirmed. */
export function DecisionRecord({ d }: { d: Decision }) {
  return (
    <div className="panel stack" style={{ background: "var(--paper)", borderColor: d.outcome === "approved" ? "var(--success)" : "var(--line)" }}>
      <div className="eyebrow">Decision record</div>
      <p style={{ margin: 0, fontSize: 18 }}>
        <strong>{d.outcome === "approved" ? "Approved" : "Declined"}</strong> by {d.decidedByName ?? d.decidedBy} on {fmt(d.decidedAt)}
      </p>
      {d.authorityStatement ? <blockquote className="quote" style={{ fontSize: 15 }}>{d.authorityStatement}</blockquote> : null}
      {d.comment ? (
        <p style={{ margin: 0 }}>
          <span className="diff-label muted">Comment </span>
          {d.comment}
        </p>
      ) : null}
      <p className="hint" style={{ margin: 0 }}>
        Applies to assessment R{d.revNo} · {d.decidedBy} · fingerprint <span className="mono">{d.revisionDigest.slice(7, 23)}</span>
      </p>
    </div>
  );
}
