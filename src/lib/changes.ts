import { z } from "zod";
import { canonicalJson, recordAudit } from "./audit";
import { sha256 } from "./crypto";
import { pool, query, tx, type Db } from "./db";
import { isUuid } from "./projects";

export const crRef = (n: number) => `CR-${String(n).padStart(3, "0")}`;

export type CrStatus = "submitted" | "assessing" | "awaiting_client" | "approved" | "rejected" | "incorporated" | "withdrawn";

export const STATUS_LABEL: Record<CrStatus, string> = {
  submitted: "Logged",
  assessing: "Assessing",
  awaiting_client: "Awaiting client",
  approved: "Approved",
  rejected: "Declined",
  incorporated: "In baseline",
  withdrawn: "Withdrawn",
};

/** The same states in the client's own words. */
export const CLIENT_STATUS_LABEL: Record<CrStatus, string> = {
  ...STATUS_LABEL,
  awaiting_client: "Awaiting your decision",
  rejected: "Declined",
};

/** States in which the agency can still work on the assessment. */
const OPEN: CrStatus[] = ["submitted", "assessing", "awaiting_client"];

// ---------- money ----------

/** "14,200" or "£14,200.50" → 1420000 (minor units). Null if empty; undefined if unreadable. */
export function parseMoney(raw: string): number | null | undefined {
  const s = raw.replace(/[£$€,\s]/g, "");
  if (s === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

// ---------- types ----------

export type ChangeRequest = {
  id: string;
  number: number;
  ref: string;
  title: string;
  requestText: string;
  source: string;
  requestedBy: string | null;
  requestedOn: string | null;
  wantedBy: string | null;
  status: CrStatus;
  sourceVersion: number;
  sourceBaselineId: string;
  createdAt: Date;
};

type CrRow = {
  id: string;
  number: number;
  title: string;
  request_text: string;
  source: string;
  requested_by: string | null;
  requested_on: string | null;
  wanted_by: string | null;
  status: CrStatus;
  version_number: number;
  source_baseline_id: string;
  created_at: Date;
};

const toCr = (r: CrRow): ChangeRequest => ({
  id: r.id,
  number: r.number,
  ref: crRef(r.number),
  title: r.title,
  requestText: r.request_text,
  source: r.source,
  requestedBy: r.requested_by,
  requestedOn: r.requested_on,
  wantedBy: r.wanted_by,
  status: r.status,
  sourceVersion: r.version_number,
  sourceBaselineId: r.source_baseline_id,
  createdAt: r.created_at,
});

const CR_SELECT = `
  select c.id, c.number, c.title, c.request_text, c.source, c.requested_by,
         to_char(c.requested_on, 'YYYY-MM-DD') as requested_on, to_char(c.wanted_by, 'YYYY-MM-DD') as wanted_by,
         c.status, b.version_number, c.source_baseline_id, c.created_at
  from change_request c join baseline b on b.id = c.source_baseline_id
  where c.project_id = $1 and c.tenant_id = $2`;

export type ImpactDraft = {
  affectedKeys: string[];
  scopeChange: string | null;
  effortMinDays: number | null;
  effortMaxDays: number | null;
  priceMinor: number | null;
  pricingBasis: "fixed" | "estimate" | "no_charge" | null;
  scheduleDays: number | null;
  assumptions: string | null;
  risks: string | null;
};

export const emptyDraft: ImpactDraft = {
  affectedKeys: [],
  scopeChange: null,
  effortMinDays: null,
  effortMaxDays: null,
  priceMinor: null,
  pricingBasis: null,
  scheduleDays: null,
  assumptions: null,
  risks: null,
};

/** What the client sees and decides on. Frozen into each published revision. */
export type AssessmentPayload = {
  changeRequest: string;
  title: string;
  sourceVersion: number;
  sourceDigest: string;
  affectedItems: { key: string; title: string }[];
  scopeChange: string;
  effort: { minDays: number; maxDays: number };
  price: { amountMinor: number; currency: string; basis: "fixed" | "estimate" | "no_charge" };
  scheduleDays: number;
  assumptions: string | null;
  risks: string | null;
};

export type Revision = {
  id: string;
  revNo: number;
  payload: AssessmentPayload;
  digest: string;
  publishedAt: Date;
  publishedBy: string | null;
};

// ---------- reading ----------

export async function listChangeRequests(tenantId: string, projectId: string) {
  const rows = await query<CrRow & { latest_rev: number | null; latest_payload: AssessmentPayload | null }>(
    `select x.*, r.rev_no as latest_rev, r.payload as latest_payload from (${CR_SELECT}) x
     left join lateral (
       select rev_no, payload from impact_revision where change_request_id = x.id order by rev_no desc limit 1
     ) r on true
     order by x.number desc`,
    [projectId, tenantId],
  );
  return rows.map((r) => ({ ...toCr(r), latestRev: r.latest_rev, latest: r.latest_payload }));
}

export async function getChangeRequest(tenantId: string, projectId: string, number: number): Promise<ChangeRequest | null> {
  if (!isUuid(projectId) || !Number.isInteger(number) || number < 1) return null;
  const rows = await query<CrRow>(`${CR_SELECT} and c.number = $3`, [projectId, tenantId, number]);
  return rows[0] ? toCr(rows[0]) : null;
}

type DraftRow = {
  affected_keys: string[];
  scope_change: string | null;
  effort_min_days: string | null;
  effort_max_days: string | null;
  price_minor: string | null;
  pricing_basis: ImpactDraft["pricingBasis"];
  schedule_days: number | null;
  assumptions: string | null;
  risks: string | null;
};

async function readDraft(db: Db, crId: string): Promise<ImpactDraft> {
  const r = (await db.query<DraftRow>("select * from impact_draft where change_request_id = $1", [crId])).rows[0];
  if (!r) return emptyDraft;
  return {
    affectedKeys: r.affected_keys,
    scopeChange: r.scope_change,
    effortMinDays: r.effort_min_days === null ? null : Number(r.effort_min_days),
    effortMaxDays: r.effort_max_days === null ? null : Number(r.effort_max_days),
    priceMinor: r.price_minor === null ? null : Number(r.price_minor),
    pricingBasis: r.pricing_basis,
    scheduleDays: r.schedule_days,
    assumptions: r.assumptions,
    risks: r.risks,
  };
}

export const getImpactDraft = (crId: string) => readDraft(pool(), crId);

export async function listRevisions(crId: string): Promise<Revision[]> {
  const rows = await query<{ id: string; rev_no: number; payload: AssessmentPayload; content_digest: string; published_at: Date; email: string | null }>(
    `select r.id, r.rev_no, r.payload, r.content_digest, r.published_at, coalesce(u.display_name, u.email) as email
     from impact_revision r left join app_user u on u.id = r.published_by
     where r.change_request_id = $1 order by r.rev_no desc`,
    [crId],
  );
  return rows.map((r) => ({
    id: r.id,
    revNo: r.rev_no,
    payload: r.payload,
    digest: r.content_digest,
    publishedAt: r.published_at,
    publishedBy: r.email,
  }));
}

export const assessmentDigest = (crId: string, revNo: number, p: AssessmentPayload) =>
  `sha256:${sha256(canonicalJson({ changeRequestId: crId, revNo, assessment: p }))}`;

// ---------- raising ----------

const isoDate = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), "Use a valid date")
  .transform((v) => v || null);

export const raiseInput = z.object({
  title: z.string().trim().min(1, "Give the change a short title").max(200),
  requestText: z.string().trim().min(1, "Record what the client asked for").max(10000),
  source: z.enum(["email", "meeting", "call", "document", "other"]),
  requestedBy: z
    .string()
    .trim()
    .max(160)
    .transform((v) => v || null),
  requestedOn: isoDate,
  wantedBy: isoDate,
});

export async function raiseChangeRequest(p: {
  tenantId: string;
  projectId: string;
  actorUserId: string;
  input: unknown;
}): Promise<{ ok: true; number: number } | { ok: false; error: string }> {
  const parsed = raiseInput.safeParse(p.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  return tx(async (db) => {
    const project = await db.query("select id from project where id = $1 and tenant_id = $2 for update", [p.projectId, p.tenantId]);
    if (project.rowCount === 0) return { ok: false, error: "Project not found" } as const;
    const latest = (
      await db.query<{ id: string; version_number: number }>(
        "select id, version_number from baseline where project_id = $1 order by version_number desc limit 1",
        [p.projectId],
      )
    ).rows[0];
    if (!latest) return { ok: false, error: "Publish the agreed scope first. A change is always raised against a version." } as const;
    const number = (
      await db.query<{ cr_counter: number }>("update project set cr_counter = cr_counter + 1 where id = $1 returning cr_counter", [p.projectId])
    ).rows[0].cr_counter;
    const cr = (
      await db.query<{ id: string }>(
        `insert into change_request
           (tenant_id, project_id, number, source_baseline_id, title, request_text, source, requested_by, requested_on, wanted_by, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [p.tenantId, p.projectId, number, latest.id, v.title, v.requestText, v.source, v.requestedBy, v.requestedOn, v.wantedBy, p.actorUserId],
      )
    ).rows[0];
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "change.raised",
      target: `change:${cr.id}`,
      detail: { ref: crRef(number), title: v.title, againstVersion: latest.version_number, source: v.source },
    });
    return { ok: true, number } as const;
  });
}

// ---------- assessing ----------

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const optNumber = (label: string, min: number, max: number, integer = false) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        ctx.addIssue({ code: "custom", message: `${label} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}` });
        return z.NEVER;
      }
      return integer ? n : Math.round(n * 10) / 10;
    });

export const draftInput = z.object({
  affectedKeys: z.array(z.string().trim().toUpperCase()).max(500),
  scopeChange: optText(10000),
  effortMinDays: optNumber("Minimum effort", 0, 99999),
  effortMaxDays: optNumber("Maximum effort", 0, 99999),
  price: z
    .string()
    .transform((v, ctx) => {
      const m = parseMoney(v);
      if (m === undefined) {
        ctx.addIssue({ code: "custom", message: "Enter the price as a number, e.g. 14,200" });
        return z.NEVER;
      }
      return m;
    }),
  pricingBasis: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.enum(["fixed", "estimate", "no_charge"]).nullable()),
  scheduleDays: optNumber("Schedule change", -365, 365, true),
  assumptions: optText(5000),
  risks: optText(5000),
});

async function lockOpenCr(db: Db, tenantId: string, projectId: string, number: number) {
  return (
    await db.query<{ id: string; status: CrStatus; source_baseline_id: string; title: string }>(
      `select id, status, source_baseline_id, title from change_request
       where project_id = $1 and tenant_id = $2 and number = $3 for update`,
      [projectId, tenantId, number],
    )
  ).rows[0];
}

export async function saveImpactDraft(p: {
  tenantId: string;
  projectId: string;
  number: number;
  actorUserId: string;
  input: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = draftInput.safeParse(p.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  return tx(async (db) => {
    const cr = await lockOpenCr(db, p.tenantId, p.projectId, p.number);
    if (!cr) return { ok: false, error: "Change request not found" } as const;
    if (!OPEN.includes(cr.status)) return { ok: false, error: `This change is ${STATUS_LABEL[cr.status].toLowerCase()} and can't be reassessed.` } as const;
    const valid = new Set(
      (await db.query<{ canonical_key: string }>("select canonical_key from baseline_item where baseline_id = $1", [cr.source_baseline_id])).rows.map((r) => r.canonical_key),
    );
    const keys = [...new Set(v.affectedKeys)];
    const unknown = keys.filter((k) => !valid.has(k));
    if (unknown.length) return { ok: false, error: `${unknown.join(", ")} isn't in the version this change was raised against.` } as const;
    await db.query(
      `insert into impact_draft (change_request_id, affected_keys, scope_change, effort_min_days, effort_max_days, price_minor,
                                 pricing_basis, schedule_days, assumptions, risks, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (change_request_id) do update set
         affected_keys = excluded.affected_keys, scope_change = excluded.scope_change,
         effort_min_days = excluded.effort_min_days, effort_max_days = excluded.effort_max_days,
         price_minor = excluded.price_minor, pricing_basis = excluded.pricing_basis, schedule_days = excluded.schedule_days,
         assumptions = excluded.assumptions, risks = excluded.risks, updated_by = excluded.updated_by, updated_at = now()`,
      [cr.id, keys, v.scopeChange, v.effortMinDays, v.effortMaxDays, v.price, v.pricingBasis, v.scheduleDays, v.assumptions, v.risks, p.actorUserId],
    );
    if (cr.status === "submitted") {
      await db.query("update change_request set status = 'assessing', updated_at = now() where id = $1", [cr.id]);
    }
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "change.assessment_saved",
      target: `change:${cr.id}`,
      detail: { affected: keys, priceMinor: v.price, basis: v.pricingBasis },
    });
    return { ok: true } as const;
  });
}

/** Problems that stop an assessment going to the client (FR-013: commercial fields must be complete). */
export function assessmentProblems(d: ImpactDraft): string[] {
  const problems: string[] = [];
  if (!d.scopeChange) problems.push("Describe what changes in the scope, in plain language for the client.");
  if (d.effortMinDays === null || d.effortMaxDays === null) problems.push("Give an effort range (minimum and maximum days).");
  else if (d.effortMinDays > d.effortMaxDays) problems.push("The minimum effort can't be more than the maximum.");
  if (!d.pricingBasis) problems.push("Choose a pricing basis.");
  else if (d.pricingBasis !== "no_charge" && (d.priceMinor === null || d.priceMinor <= 0)) problems.push("Enter the price, or choose \"No charge\".");
  if (d.scheduleDays === null) problems.push("Give the schedule impact in working days (0 if none).");
  return problems;
}

export async function publishAssessment(p: {
  tenantId: string;
  projectId: string;
  number: number;
  actorUserId: string;
}): Promise<{ ok: true; revNo: number } | { ok: false; errors: string[] }> {
  return tx(async (db) => {
    const cr = await lockOpenCr(db, p.tenantId, p.projectId, p.number);
    if (!cr) return { ok: false, errors: ["Change request not found"] } as const;
    if (!OPEN.includes(cr.status)) return { ok: false, errors: [`This change is ${STATUS_LABEL[cr.status].toLowerCase()}.`] } as const;
    const d = await readDraft(db, cr.id);
    const problems = assessmentProblems(d);
    if (problems.length) return { ok: false, errors: problems } as const;

    const project = (await db.query<{ currency: string }>("select currency from project where id = $1", [p.projectId])).rows[0];
    const base = (
      await db.query<{ version_number: number; content_digest: string }>("select version_number, content_digest from baseline where id = $1", [cr.source_baseline_id])
    ).rows[0];
    const titles = new Map(
      (
        await db.query<{ canonical_key: string; title: string }>(
          "select canonical_key, payload->>'title' as title from baseline_item where baseline_id = $1",
          [cr.source_baseline_id],
        )
      ).rows.map((r) => [r.canonical_key, r.title]),
    );
    const number = p.number;
    const payload: AssessmentPayload = {
      changeRequest: crRef(number),
      title: cr.title,
      sourceVersion: base.version_number,
      sourceDigest: base.content_digest,
      affectedItems: [...d.affectedKeys].sort().map((k) => ({ key: k, title: titles.get(k) ?? "" })),
      scopeChange: d.scopeChange!,
      effort: { minDays: d.effortMinDays!, maxDays: d.effortMaxDays! },
      price: { amountMinor: d.pricingBasis === "no_charge" ? 0 : d.priceMinor!, currency: project.currency, basis: d.pricingBasis! },
      scheduleDays: d.scheduleDays!,
      assumptions: d.assumptions,
      risks: d.risks,
    };
    const latest = (
      await db.query<{ rev_no: number; payload: AssessmentPayload }>(
        "select rev_no, payload from impact_revision where change_request_id = $1 order by rev_no desc limit 1",
        [cr.id],
      )
    ).rows[0];
    if (latest && canonicalJson(latest.payload) === canonicalJson(payload)) {
      return { ok: false, errors: [`Nothing has changed since assessment R${latest.rev_no}.`] } as const;
    }
    const revNo = (latest?.rev_no ?? 0) + 1;
    await db.query(
      `insert into impact_revision (tenant_id, change_request_id, rev_no, payload, content_digest, published_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [p.tenantId, cr.id, revNo, JSON.stringify(payload), assessmentDigest(cr.id, revNo, payload), p.actorUserId],
    );
    await db.query("update change_request set status = 'awaiting_client', updated_at = now() where id = $1", [cr.id]);
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "change.assessment_published",
      target: `change:${cr.id}`,
      detail: { ref: crRef(number), revNo, priceMinor: payload.price.amountMinor, basis: payload.price.basis, scheduleDays: payload.scheduleDays },
    });
    return { ok: true, revNo } as const;
  });
}

export async function withdrawChange(p: {
  tenantId: string;
  projectId: string;
  number: number;
  actorUserId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = p.reason.trim();
  if (!reason) return { ok: false, error: "Say why the change is being withdrawn." };
  return tx(async (db) => {
    const cr = await lockOpenCr(db, p.tenantId, p.projectId, p.number);
    if (!cr) return { ok: false, error: "Change request not found" } as const;
    if (!OPEN.includes(cr.status)) return { ok: false, error: "This change can no longer be withdrawn." } as const;
    await db.query("update change_request set status = 'withdrawn', updated_at = now() where id = $1", [cr.id]);
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "change.withdrawn",
      target: `change:${cr.id}`,
      detail: { ref: crRef(p.number), reason: reason.slice(0, 1000) },
    });
    return { ok: true } as const;
  });
}
