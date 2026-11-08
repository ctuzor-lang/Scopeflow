import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AssessmentView as Assessment } from "@/components/AssessmentView";
import { AiPanel } from "@/components/AiPanel";
import { DecisionRecord } from "@/components/DecisionRecord";
import { aiEnabledForTenant, listSuggestions } from "@/lib/ai";
import { Disclosure } from "@/components/Disclosure";
import { Thread } from "@/components/Thread";
import { getDecision, listComments } from "@/lib/decisions";
import { baselineItems, versionIncludingChange } from "@/lib/baselines";
import {
  STATUS_LABEL,
  assessmentProblems,
  formatMoney,
  getChangeRequest,
  getImpactDraft,
  listRevisions,
} from "@/lib/changes";
import { canPublish, getProject, projectProgress } from "@/lib/projects";
import { currentTenant, requireUser } from "@/lib/request";
import { agencyCommentAction, publishAssessmentAction, saveAssessmentAction, withdrawAction } from "../../../changes-actions";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(d);
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
const SOURCE: Record<string, string> = { email: "email", meeting: "meeting", call: "call", document: "document", other: "other" };


function moneyInput(minor: number | null) {
  if (minor === null) return "";
  return (minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0 });
}

export default async function ChangePage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
  const { projectId, number } = await params;
  const tenant = await currentTenant();
  const user = await requireUser();
  const project = await getProject(tenant.id, projectId);
  const n = Number(number);
  const cr = project ? await getChangeRequest(tenant.id, projectId, n) : null;
  if (!project || !cr) notFound();

  const [draft, revisions, items, decision, comments] = await Promise.all([
    getImpactDraft(cr.id),
    listRevisions(cr.id),
    baselineItems(cr.sourceBaselineId),
    getDecision(cr.id),
    listComments(cr.id),
  ]);
  const [aiOn, suggestions, progress] = await Promise.all([aiEnabledForTenant(tenant.id), listSuggestions(cr.id), projectProgress(tenant.id, projectId)]);
  const inVersion = cr.status === "incorporated" ? await versionIncludingChange(cr.id) : null;
  const open = ["submitted", "assessing", "awaiting_client"].includes(cr.status);
  const problems = assessmentProblems(draft);
  const latest = revisions[0];
  const affected = new Set(draft.affectedKeys);
  // Whether the saved assessment still matches the newest published revision.
  const unchanged =
    !!latest &&
    [...draft.affectedKeys].sort().join(",") === latest.payload.affectedItems.map((i) => i.key).join(",") &&
    draft.scopeChange === latest.payload.scopeChange &&
    draft.effortMinDays === latest.payload.effort.minDays &&
    draft.effortMaxDays === latest.payload.effort.maxDays &&
    draft.pricingBasis === latest.payload.price.basis &&
    (draft.pricingBasis === "no_charge" || draft.priceMinor === latest.payload.price.amountMinor) &&
    draft.scheduleDays === latest.payload.scheduleDays &&
    (draft.assumptions ?? null) === latest.payload.assumptions &&
    (draft.risks ?? null) === latest.payload.risks;

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link href={`/projects/${projectId}/changes`} className="hint">
            ← All changes
          </Link>
          <div className="eyebrow" style={{ marginTop: 8 }}>
            {cr.ref} · against version {cr.sourceVersion}
          </div>
          <h2 style={{ fontSize: 32, fontWeight: 800, marginTop: 6 }}>{cr.title}</h2>
        </div>
        <span className={`status status-${cr.status}`}>{STATUS_LABEL[cr.status]}</span>
      </div>

      <div className="split">
        <section className="main stack" style={{ gap: 28 }}>
          {decision ? <DecisionRecord d={decision} /> : null}
          {decision ? (
            <p className="note" style={{ margin: 0 }}>
              <a href={`/projects/${projectId}/changes/${n}/note.pdf`}>Download the change control note (PDF)</a>
            </p>
          ) : null}
          {cr.status === "approved" ? (
            <div className="panel stack">
              <h3 style={{ fontSize: 20, fontWeight: 700 }}>Next: put it into the agreed scope</h3>
              <p style={{ margin: 0 }}>
                Update the <Link href={`/projects/${projectId}/scope`}>scope draft</Link> to reflect this change, then publish
                a new version and tick {cr.ref} as included.
              </p>
            </div>
          ) : null}
          {inVersion ? (
            <p className="note ok" style={{ margin: 0 }}>
              Put into effect in <Link href={`/projects/${projectId}/versions/${inVersion}`}>version {inVersion}</Link>.
            </p>
          ) : null}
          <div className="stack" style={{ gap: 10 }}>
            <div className="eyebrow">What the client asked for</div>
            <blockquote className="quote">{cr.requestText}</blockquote>
            <p className="hint" style={{ margin: 0 }}>
              {cr.requestedBy ?? "Requester not recorded"} · by {SOURCE[cr.source]}
              {cr.requestedOn ? ` on ${fmtDay(cr.requestedOn)}` : ""}
              {cr.wantedBy ? ` · wanted by ${fmtDay(cr.wantedBy)}` : ""}
            </p>
          </div>

          {open && aiOn ? <AiPanel projectId={projectId} number={n} suggestions={suggestions} /> : null}

          {open ? (
            <div className="panel">
              <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Impact assessment</h3>
              <ActionForm action={saveAssessmentAction.bind(null, projectId, n)} submitLabel="Save assessment" pendingLabel="Saving…">
                <fieldset>
                  <legend>Agreed items this affects (version {cr.sourceVersion})</legend>
                  <div className="checklist">
                    {items.map((i) => (
                      <label key={i.key} className="check">
                        <input type="checkbox" name="affected" value={i.key} defaultChecked={affected.has(i.key)} />
                        <span>
                          <span className="mono">{i.key}</span> {i.title}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  What changes, in plain language for the client
                  <textarea name="scopeChange" defaultValue={draft.scopeChange ?? ""} maxLength={10000} placeholder="Checkout will accept one gift card plus one card. Refunds go back across both." />
                </label>
                <div className="grid-2">
                  <label>
                    Effort, minimum (days)
                    <input type="text" inputMode="decimal" name="effortMinDays" defaultValue={draft.effortMinDays ?? ""} />
                  </label>
                  <label>
                    Effort, maximum (days)
                    <input type="text" inputMode="decimal" name="effortMaxDays" defaultValue={draft.effortMaxDays ?? ""} />
                  </label>
                  <label>
                    Pricing basis
                    <select name="pricingBasis" defaultValue={draft.pricingBasis ?? ""}>
                      <option value="">Choose…</option>
                      <option value="fixed">Fixed price</option>
                      <option value="estimate">Estimate</option>
                      <option value="no_charge">No charge</option>
                    </select>
                  </label>
                  <label>
                    Price ({project.currency}, excluding VAT)
                    <input type="text" inputMode="decimal" name="price" defaultValue={moneyInput(draft.priceMinor)} placeholder="14,200" />
                  </label>
                  <label>
                    Schedule change (working days)
                    <input type="text" inputMode="numeric" name="scheduleDays" defaultValue={draft.scheduleDays ?? ""} placeholder="0 if none" />
                  </label>
                </div>
                <label>
                  Assumptions <span className="hint">(optional)</span>
                  <textarea name="assumptions" defaultValue={draft.assumptions ?? ""} maxLength={5000} />
                </label>
                <label>
                  Risks <span className="hint">(optional)</span>
                  <textarea name="risks" defaultValue={draft.risks ?? ""} maxLength={5000} />
                </label>
              </ActionForm>
            </div>
          ) : null}

          {latest ? (
            <div className="stack">
              <h3 style={{ fontSize: 22, fontWeight: 700 }}>What the client sees</h3>
              <div className="panel" style={{ background: "var(--paper)" }}>
                <Assessment p={latest.payload} revNo={latest.revNo} />
              </div>
            </div>
          ) : null}

          {latest ? (
            <section className="stack">
              <h3 style={{ fontSize: 22, fontWeight: 700 }}>Questions from the client</h3>
              <Thread comments={comments} agencyName={tenant.branding.displayName} />
              <ActionForm action={agencyCommentAction.bind(null, projectId, n)} submitLabel="Send reply" pendingLabel="Sending…" resetOnSuccess>
                <label>
                  Reply to the client
                  <textarea name="body" required maxLength={5000} />
                </label>
              </ActionForm>
            </section>
          ) : null}
        </section>

        <aside className="side stack">
          {open && canPublish(user.role) ? (
            <div className="panel stack">
              <h3 style={{ fontSize: 20, fontWeight: 700 }}>
                {unchanged ? "Sent to the client" : latest ? `Send revision R${latest.revNo + 1}` : "Send for the client's decision"}
              </h3>
              {unchanged ? (
                <p className="muted" style={{ margin: 0, fontSize: 15 }}>
                  R{latest!.revNo} is with the client. To send a revision, change the assessment and save it first.
                </p>
              ) : problems.length ? (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: 15 }}>Before it can go to the client, the saved assessment needs:</p>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15 }}>
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: 15 }}>
                    This freezes the last saved assessment as R{(latest?.revNo ?? 0) + 1} and emails the client&apos;s people to
                    review it. {latest ? `It replaces R${latest.revNo}; the client can only decide on the newest.` : "They see the figures only after signing in."}
                  </p>
                  {progress.approvers === 0 ? (
                    <p className="note" style={{ margin: 0 }}>
                      No one at {project.clientName} can approve yet.{" "}
                      <Link href={`/projects/${projectId}/clients`}>Invite an approver</Link> so they can decide.
                    </p>
                  ) : null}
                  <ActionForm action={publishAssessmentAction.bind(null, projectId, n)} submitLabel={`Publish R${(latest?.revNo ?? 0) + 1}`} pendingLabel="Publishing…" buttonClass="btn accent">
                    <label className="check">
                      <input type="checkbox" name="confirm" />
                      <span>I&apos;ve reviewed the figures and they are ours to stand behind.</span>
                    </label>
                  </ActionForm>
                </>
              )}
            </div>
          ) : null}

          {revisions.length ? (
            <div className="panel stack">
              <div className="eyebrow">Published revisions</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                {revisions.map((r, idx) => (
                  <li key={r.id} style={{ fontSize: 14 }}>
                    <strong>R{r.revNo}</strong> {idx === 0 ? "· current" : "· replaced"}
                    <div className="hint">
                      {r.payload.price.basis === "no_charge" ? "No charge" : formatMoney(r.payload.price.amountMinor, r.payload.price.currency)} ·{" "}
                      {fmt(r.publishedAt)} · {r.publishedBy ?? "unknown"}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{r.digest.slice(7, 23)}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {open && canPublish(user.role) ? (
            <Disclosure title="Withdraw this change">
              <ActionForm action={withdrawAction.bind(null, projectId, n)} submitLabel="Withdraw change" pendingLabel="Withdrawing…">
                <label>
                  Reason
                  <textarea name="reason" required maxLength={1000} placeholder="Client decided not to proceed" />
                </label>
              </ActionForm>
            </Disclosure>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
