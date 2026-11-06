import { formatMoney, type AssessmentPayload } from "@/lib/changes";

const BASIS: Record<string, string> = { fixed: "Fixed price", estimate: "Estimate", no_charge: "No charge" };

/** The published assessment, as the client will see it. */
export function AssessmentView({ p, revNo, audience = "agency" }: { p: AssessmentPayload; revNo: number; audience?: "agency" | "client" }) {
  const days = (n: number) => `${n > 0 ? "+" : ""}${n} working day${Math.abs(n) === 1 ? "" : "s"}`;
  return (
    <div className="stack">
      <div className="figures">
        <div>
          <div className="eyebrow">{BASIS[p.price.basis]}</div>
          <div className="num">{p.price.basis === "no_charge" ? "£0" : formatMoney(p.price.amountMinor, p.price.currency)}</div>
        </div>
        <div>
          <div className="eyebrow">Effort</div>
          <div className="num">
            {p.effort.minDays}–{p.effort.maxDays} days
          </div>
        </div>
        <div>
          <div className="eyebrow">Schedule</div>
          <div className="num">{p.scheduleDays === 0 ? "No change" : days(p.scheduleDays)}</div>
        </div>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>What changes</div>
        <p style={{ margin: 0, whiteSpace: "pre-line" }}>{p.scopeChange}</p>
      </div>
      {p.affectedItems.length ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Agreed items affected (version {p.sourceVersion})</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {p.affectedItems.map((i) => (
              <li key={i.key}>
                <span className="mono">{i.key}</span> {i.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.assumptions ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Assumptions</div>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{p.assumptions}</p>
        </div>
      ) : null}
      {p.risks ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Risks</div>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{p.risks}</p>
        </div>
      ) : null}
      <p className="hint" style={{ margin: 0 }}>Assessment R{revNo}. {audience === "client" ? "Your" : "The client\u2019s"} decision applies to this exact revision only.</p>
    </div>
  );
}

