import { ActionForm } from "@/components/ActionForm";
import type { Suggestion } from "@/lib/ai";
import { acceptSuggestionAction, dismissSuggestionAction, suggestAction } from "@/app/projects/changes-actions";

const GROUPS: [Suggestion["kind"], string, string][] = [
  ["summary", "Plain-language summary", "Use as the description"],
  ["affected_item", "Agreed items that may be affected", "Tick this item"],
  ["risk", "Risks", "Add to risks"],
  ["assumption", "Assumptions", "Add to assumptions"],
  ["question", "Questions to ask the client first", "Send to the client"],
];

/** AI suggestions for an impact assessment. Advisory only: each one needs a person to accept it. */
export function AiPanel({ projectId, number, suggestions }: { projectId: string; number: number; suggestions: Suggestion[] }) {
  return (
    <div className="panel stack">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h3 style={{ fontSize: 20, fontWeight: 700 }}>AI suggestions</h3>
        <span className="hint">A starting point only. Nothing changes until you accept a suggestion, and AI never sets prices.</span>
      </div>
      <ActionForm action={suggestAction.bind(null, projectId, number)} submitLabel={suggestions.length ? "Suggest again" : "Suggest impacts"} pendingLabel="Thinking… (up to 30 seconds)" buttonClass="btn">
        <span className="hint">Sends the request text and the agreed items (no prices or names) to the AI service.</span>
      </ActionForm>
      {GROUPS.map(([kind, label, acceptLabel]) => {
        const items = suggestions.filter((s) => s.kind === kind && s.status !== "dismissed");
        if (!items.length) return null;
        return (
          <div key={kind} className="stack" style={{ gap: 8 }}>
            <div className="eyebrow">{label}</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {items.map((s) => (
                <li key={s.id} style={{ background: "var(--paper)", border: "1px dashed var(--line)", padding: "10px 12px" }}>
                  <div style={{ fontSize: 15 }}>
                    {s.key ? <span className="mono">{s.key} </span> : null}
                    {s.text}
                  </div>
                  {s.status === "accepted" ? (
                    <div className="hint" style={{ marginTop: 6 }}>Accepted</div>
                  ) : (
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <form action={acceptSuggestionAction.bind(null, projectId, number, s.id)}>
                        <button type="submit" className="linkbtn">{acceptLabel}</button>
                      </form>
                      <form action={dismissSuggestionAction.bind(null, projectId, number, s.id)}>
                        <button type="submit" className="linkbtn" style={{ color: "var(--muted)" }}>Dismiss</button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
