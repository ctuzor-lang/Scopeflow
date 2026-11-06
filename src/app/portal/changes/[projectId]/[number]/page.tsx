import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AssessmentView } from "@/components/AssessmentView";
import { DecisionRecord } from "@/components/DecisionRecord";
import { Disclosure } from "@/components/Disclosure";
import { PortalShell } from "@/components/PortalShell";
import { Thread } from "@/components/Thread";
import { CLIENT_STATUS_LABEL, getChangeRequest, listRevisions } from "@/lib/changes";
import { clientRole } from "@/lib/clients";
import { authorityStatement, getDecision, listComments } from "@/lib/decisions";
import { getProject } from "@/lib/projects";
import { currentTenant, requireClient } from "@/lib/request";
import { clientCommentAction, decideAction } from "../../../actions";

const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
const CLIENT_VISIBLE = ["awaiting_client", "approved", "rejected", "incorporated"];

export default async function ClientChangePage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
  const { projectId, number } = await params;
  const tenant = await currentTenant();
  const user = await requireClient();
  const role = await clientRole(tenant.id, projectId, user.userId);
  const n = Number(number);
  const cr = role ? await getChangeRequest(tenant.id, projectId, n) : null;
  if (!role || !cr || !CLIENT_VISIBLE.includes(cr.status)) notFound();
  const project = (await getProject(tenant.id, projectId))!;
  const [revisions, decision, comments] = await Promise.all([listRevisions(cr.id), getDecision(cr.id), listComments(cr.id)]);
  const latest = revisions[0];
  if (!latest) notFound();
  const statement = authorityStatement({ clientName: project.clientName, ref: cr.ref, revNo: latest.revNo, payload: latest.payload });
  const canDecide = role === "approver" && cr.status === "awaiting_client";

  return (
    <PortalShell tenant={tenant} who={user.displayName ?? user.email}>
      <Link href="/portal" className="hint">
        ← Your decisions
      </Link>
      <div className="stack" style={{ marginTop: 12, gap: 24 }}>
        <div>
          <div className="eyebrow">
            {project.name} · {cr.ref} · assessment R{latest.revNo}
            {cr.wantedBy && cr.status === "awaiting_client" ? ` · wanted by ${fmtDay(cr.wantedBy)}` : ""}
          </div>
          <h1 style={{ fontSize: "clamp(28px, 6vw, 40px)", fontWeight: 800, margin: "8px 0 10px" }}>{cr.title}</h1>
          <span className={`status status-${cr.status}`}>{CLIENT_STATUS_LABEL[cr.status]}</span>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">Your request</div>
          <blockquote className="quote">{cr.requestText}</blockquote>
        </div>

        <div className="panel" style={{ background: "var(--paper)" }}>
          <AssessmentView p={latest.payload} revNo={latest.revNo} audience="client" />
        </div>

        {decision ? <DecisionRecord d={decision} /> : null}

        {canDecide ? (
          <div className="panel stack">
            <h2 style={{ fontSize: 24, fontWeight: 700 }}>Your decision</h2>
            <ActionForm
              action={decideAction.bind(null, projectId, n, latest.id, "approved")}
              submitLabel={`Approve assessment R${latest.revNo}`}
              pendingLabel="Recording…"
              buttonClass="btn accent"
            >
              <label className="check">
                <input type="checkbox" name="authority" required />
                <span>{statement}</span>
              </label>
            </ActionForm>
            <Disclosure title="Decline this change">
              <ActionForm action={decideAction.bind(null, projectId, n, latest.id, "rejected")} submitLabel="Decline, keep the agreed scope" pendingLabel="Recording…">
                <label>
                  Reason <span className="hint">(optional)</span>
                  <textarea name="comment" maxLength={5000} />
                </label>
              </ActionForm>
            </Disclosure>
          </div>
        ) : cr.status === "awaiting_client" ? (
          <p className="note">You can view this change and ask questions. A named approver at your organisation makes the decision.</p>
        ) : null}

        <section className="stack">
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Questions</h2>
          <Thread comments={comments} agencyName={tenant.branding.displayName} />
          <ActionForm action={clientCommentAction.bind(null, projectId, n)} submitLabel="Send question" pendingLabel="Sending…" resetOnSuccess>
            <label>
              Ask {tenant.branding.displayName} a question
              <textarea name="body" required maxLength={5000} placeholder="Type your question" />
            </label>
          </ActionForm>
        </section>
      </div>
    </PortalShell>
  );
}
