import { recordAudit } from "./audit";
import { crRef, formatMoney, type AssessmentPayload } from "./changes";
import { tenantBaseUrl } from "./clients";
import { one, query, tx } from "./db";
import { mailer, mailError } from "./mailer";
import type { Tenant } from "./tenant";

/**
 * The statement an approver confirms. Draft wording: a lawyer should review it
 * before real client use (FRS-001 §3.2). It names the exact revision, amount and
 * organisation so the record stands on its own.
 */
/**
 * The words an approver ticks. They are stored with the decision and quoted on the change control note,
 * so they must stand on their own: who is bound, what exactly is approved (revision + fingerprint),
 * the commercial terms, and that this is a variation under the parties' agreement.
 * Draft wording — to be confirmed by a solicitor (docs/legal-review.md).
 */
export function authorityStatement(p: {
  clientName: string;
  agencyName: string;
  projectName: string;
  ref: string;
  revNo: number;
  digest: string;
  payload: AssessmentPayload;
}): string {
  const amount = formatMoney(p.payload.price.amountMinor, p.payload.price.currency);
  const price =
    p.payload.price.basis === "no_charge"
      ? "at no additional charge"
      : p.payload.price.basis === "estimate"
        ? `for an estimated ${amount} excluding VAT, to be charged as set out in our agreement`
        : `for a fixed price of ${amount} excluding VAT`;
  const days = p.payload.scheduleDays;
  const schedule =
    days === 0 ? "with no change to the schedule" : `with a schedule impact of ${days > 0 ? "+" : ""}${days} working day${Math.abs(days) === 1 ? "" : "s"}`;
  return (
    `I confirm I am authorised by ${p.clientName} to approve changes to ${p.projectName}. ` +
    `On behalf of ${p.clientName}, I approve ${p.ref} as set out in assessment R${p.revNo} (fingerprint ${p.digest.replace(/^sha256:/, "").slice(0, 12)}), ` +
    `${price}, ${schedule}. ` +
    `This varies the agreed scope under the change control terms of our agreement with ${p.agencyName}; all other terms are unchanged. ` +
    `My approval applies to this revision only.`
  );
}

export type Decision = {
  outcome: "approved" | "rejected";
  revNo: number;
  revisionDigest: string;
  decidedBy: string;
  decidedByName: string | null;
  authorityStatement: string | null;
  comment: string | null;
  decidedAt: Date;
};

export async function getDecision(crId: string): Promise<Decision | null> {
  const r = await one<{
    outcome: Decision["outcome"];
    rev_no: number;
    revision_digest: string;
    email: string;
    display_name: string | null;
    authority_statement: string | null;
    comment: string | null;
    decided_at: Date;
  }>(
    `select d.outcome, d.rev_no, d.revision_digest, u.email, u.display_name, d.authority_statement, d.comment, d.decided_at
     from change_decision d join app_user u on u.id = d.decided_by where d.change_request_id = $1`,
    [crId],
  );
  if (!r) return null;
  return {
    outcome: r.outcome,
    revNo: r.rev_no,
    revisionDigest: r.revision_digest,
    decidedBy: r.email,
    decidedByName: r.display_name,
    authorityStatement: r.authority_statement,
    comment: r.comment,
    decidedAt: r.decided_at,
  };
}

export type DecideResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_approver" | "not_awaiting" | "stale" | "authority_required"; message: string };

/**
 * Records a client's decision. It binds to the exact revision the client was
 * shown; if a newer revision has been published since, the decision is refused
 * (AC-04) so nobody approves something they didn't see.
 */
export async function decideChange(p: {
  tenant: Tenant;
  projectId: string;
  number: number;
  userId: string;
  revisionId: string;
  outcome: "approved" | "rejected";
  authorityConfirmed: boolean;
  comment: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<DecideResult> {
  const result = await tx(async (db): Promise<DecideResult & { notify?: { ref: string; title: string; projectName: string; name: string } }> => {
    const cr = (
      await db.query<{ id: string; status: string; title: string; client_name: string; project_name: string }>(
        `select c.id, c.status, c.title, o.name as client_name, p.name as project_name
         from change_request c join project p on p.id = c.project_id join client_organisation o on o.id = p.client_org_id
         where c.project_id = $1 and c.tenant_id = $2 and c.number = $3 for update of c`,
        [p.projectId, p.tenant.id, p.number],
      )
    ).rows[0];
    if (!cr) return { ok: false, reason: "not_found", message: "Change not found." };
    const access = (
      await db.query<{ role: string; display_name: string | null; email: string }>(
        `select a.role, u.display_name, u.email from project_access a join app_user u on u.id = a.user_id
         where a.project_id = $1 and a.user_id = $2 and a.tenant_id = $3 and a.status = 'active'`,
        [p.projectId, p.userId, p.tenant.id],
      )
    ).rows[0];
    if (!access || access.role !== "approver") {
      return { ok: false, reason: "not_approver", message: "Only a named approver can decide on this change." };
    }
    if (cr.status !== "awaiting_client") return { ok: false, reason: "not_awaiting", message: "This change isn't waiting for a decision." };
    const latest = (
      await db.query<{ id: string; rev_no: number; payload: AssessmentPayload; content_digest: string }>(
        "select id, rev_no, payload, content_digest from impact_revision where change_request_id = $1 order by rev_no desc limit 1",
        [cr.id],
      )
    ).rows[0];
    if (!latest || latest.id !== p.revisionId) {
      return { ok: false, reason: "stale", message: "This assessment has been updated since you opened it. Review the newest version before deciding." };
    }
    if (p.outcome === "approved" && !p.authorityConfirmed) {
      return { ok: false, reason: "authority_required", message: "Confirm you're authorised to approve this change." };
    }
    const ref = crRef(p.number);
    const statement =
      p.outcome === "approved" ? authorityStatement({ clientName: cr.client_name, agencyName: p.tenant.branding.displayName, projectName: cr.project_name, ref, revNo: latest.rev_no, digest: latest.content_digest, payload: latest.payload }) : null;
    await db.query(
      `insert into change_decision (tenant_id, change_request_id, impact_revision_id, rev_no, revision_digest, outcome,
                                    decided_by, authority_statement, comment, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.tenant.id, cr.id, latest.id, latest.rev_no, latest.content_digest, p.outcome, p.userId, statement, p.comment, p.ip, p.userAgent?.slice(0, 300) ?? null],
    );
    await db.query("update change_request set status = $2, updated_at = now() where id = $1", [cr.id, p.outcome]);
    await recordAudit(db, {
      tenantId: p.tenant.id,
      actorUserId: p.userId,
      action: p.outcome === "approved" ? "change.approved" : "change.declined",
      target: `change:${cr.id}`,
      detail: { ref, revNo: latest.rev_no, digest: latest.content_digest, statement },
      ip: p.ip,
    });
    return { ok: true, notify: { ref, title: cr.title, projectName: cr.project_name, name: access.display_name ?? access.email } };
  });

  if (result.ok && result.notify) {
    const n = result.notify;
    await notifyAgency(p.tenant, p.projectId, {
      subject: `${n.ref} ${p.outcome === "approved" ? "approved" : "declined"} by ${n.name}`,
      text: `${n.name} ${p.outcome === "approved" ? "approved" : "declined"} ${n.ref} "${n.title}" on ${n.projectName}.\n\nOpen it in ScopeFlow: ${await tenantBaseUrl(p.tenant.id)}/projects/${p.projectId}/changes/${p.number}`,
    });
  }
  return result.ok ? { ok: true } : result;
}

// ---------- questions and answers ----------

export type Comment = { id: string; side: "agency" | "client"; author: string; body: string; createdAt: Date };

export async function listComments(crId: string): Promise<Comment[]> {
  const rows = await query<{ id: string; author_side: Comment["side"]; email: string; display_name: string | null; body: string; created_at: Date }>(
    `select c.id, c.author_side, u.email, u.display_name, c.body, c.created_at
     from change_comment c join app_user u on u.id = c.author_id
     where c.change_request_id = $1 order by c.created_at, c.id`,
    [crId],
  );
  return rows.map((r) => ({ id: r.id, side: r.author_side, author: r.display_name ?? r.email, body: r.body, createdAt: r.created_at }));
}

/** Adds a comment. The caller must have checked the author can see this change. */
export async function addComment(p: {
  tenant: Tenant;
  projectId: string;
  number: number;
  userId: string;
  side: "agency" | "client";
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = p.body.trim();
  if (!body) return { ok: false, error: "Write your question or reply first." };
  if (body.length > 5000) return { ok: false, error: "Keep it under 5,000 characters." };
  const cr = await one<{ id: string; title: string; status: string }>(
    "select id, title, status from change_request where project_id = $1 and tenant_id = $2 and number = $3",
    [p.projectId, p.tenant.id, p.number],
  );
  if (!cr) return { ok: false, error: "Change not found." };
  if (p.side === "client" && !["awaiting_client", "approved", "rejected", "incorporated"].includes(cr.status)) {
    return { ok: false, error: "Change not found." };
  }
  await tx(async (db) => {
    await db.query(
      "insert into change_comment (tenant_id, change_request_id, author_id, author_side, body) values ($1, $2, $3, $4, $5)",
      [p.tenant.id, cr.id, p.userId, p.side, body],
    );
    await recordAudit(db, {
      tenantId: p.tenant.id,
      actorUserId: p.userId,
      action: "change.commented",
      target: `change:${cr.id}`,
      detail: { side: p.side, length: body.length },
    });
  });

  // Notify the other side without putting the message itself in the email (FR-017).
  const base = await tenantBaseUrl(p.tenant.id);
  const ref = crRef(p.number);
  if (p.side === "client") {
    await notifyAgency(p.tenant, p.projectId, {
      subject: `New question on ${ref}`,
      text: `The client has asked a question about ${ref} "${cr.title}".\n\nOpen it in ScopeFlow: ${base}/projects/${p.projectId}/changes/${p.number}`,
    });
  } else {
    await notifyClients(p.tenant, p.projectId, {
      subject: `${p.tenant.branding.displayName} replied on ${ref}`,
      text: `There's a new reply about ${ref} "${cr.title}".\n\nSign in to read it: ${base}/portal/changes/${p.projectId}/${p.number}`,
    });
  }
  return { ok: true };
}

// ---------- notifications ----------

async function notifyAgency(tenant: Tenant, projectId: string, mail: { subject: string; text: string }) {
  // Admins and project managers, plus whoever created the project.
  const rows = await query<{ email: string }>(
    `select distinct u.email from membership m join app_user u on u.id = m.user_id
     where m.tenant_id = $1 and m.status = 'active'
       and (m.role in ('admin', 'pm') or u.id = (select created_by from project where id = $2))`,
    [tenant.id, projectId],
  );
  for (const r of rows) await sendQuietly({ to: r.email, fromName: "ScopeFlow", subject: mail.subject, text: mail.text });
}

export async function notifyClients(tenant: Tenant, projectId: string, mail: { subject: string; text: string }) {
  const rows = await query<{ email: string }>(
    `select u.email from project_access a join app_user u on u.id = a.user_id
     where a.project_id = $1 and a.tenant_id = $2 and a.status = 'active'`,
    [projectId, tenant.id],
  );
  for (const r of rows) await sendQuietly({ to: r.email, fromName: tenant.branding.displayName, subject: mail.subject, text: mail.text });
}

/** Tells the project's client people a change is waiting for a decision. No figures in the email. */
export async function notifyDecisionNeeded(tenant: Tenant, projectId: string, number: number, title: string, revNo: number) {
  const base = await tenantBaseUrl(tenant.id);
  await notifyClients(tenant, projectId, {
    subject: `Decision needed: ${crRef(number)} ${title}`,
    text: [
      `${tenant.branding.displayName} has sent ${crRef(number)} "${title}" (assessment R${revNo}) for your decision.`,
      "",
      `Sign in to review the impact and decide: ${base}/portal/changes/${projectId}/${number}`,
    ].join("\n"),
  });
}

/** Notifications are a courtesy: the decision is already recorded, so a mail failure is logged, not thrown. */
async function sendQuietly(mail: Parameters<ReturnType<typeof mailer>["send"]>[0]) {
  try {
    await mailer().send(mail);
  } catch (err) {
    console.error(`[mail] notification NOT sent: ${mailError(err)}`);
  }
}
