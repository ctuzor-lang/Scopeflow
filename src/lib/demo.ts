import { openSession } from "./auth";
import { publishBaseline } from "./baselines";
import { publishAssessment, raiseChangeRequest, saveImpactDraft } from "./changes";
import { inviteClient } from "./clients";
import { config } from "./config";
import { hmac, randomToken } from "./crypto";
import { one, query } from "./db";
import { decideChange } from "./decisions";
import { createTenant } from "./operator";
import { createProject } from "./projects";
import { saveItem } from "./scope";
import { getTenantById, type Tenant } from "./tenant";

/** How long a visitor's sandbox lives before the hourly clean-up removes it. */
export const SANDBOX_HOURS = 24;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_ACTIVE_SANDBOXES = 300;

export type DemoRole = "agency" | "client";

const ITEMS = [
  { key: "CP-01", kind: "requirement", section: "Checkout & payments", title: "Card payments through one provider", description: "Visa, Mastercard and Amex via the chosen provider.", acceptanceCriteria: "A test payment succeeds for each card type." },
  { key: "CP-02", kind: "deliverable", section: "Checkout & payments", title: "Order confirmation email", description: "Sent when payment succeeds.", acceptanceCriteria: "Email arrives within one minute of ordering." },
  { key: "CA-01", kind: "requirement", section: "Catalogue", title: "Product listing pages with filters", description: "Filter by category, size, colour and price.", acceptanceCriteria: "Filters combine and update results in under a second." },
  { key: "CA-02", kind: "requirement", section: "Catalogue", title: "Product detail page", description: "Images, sizes, stock and delivery estimate.", acceptanceCriteria: "" },
  { key: "AC-01", kind: "requirement", section: "Accounts", title: "Customer accounts with order history", description: "", acceptanceCriteria: "Customers see orders from the last two years." },
  { key: "AS-01", kind: "assumption", section: "Assumptions", title: "Northwind provides payment-provider sandbox access", description: "Needed by the start of week 3.", acceptanceCriteria: "" },
  { key: "EX-01", kind: "exclusion", section: "Exclusions", title: "In-store tills", description: "Out of scope for this phase.", acceptanceCriteria: "" },
];

class DemoUnavailable extends Error {}

/**
 * Builds a private sandbox for one visitor: a consultancy workspace with a realistic project,
 * an agreed version, three change requests at different stages, and a client approver.
 * Everything is tied to fresh, undeliverable addresses (…@sandbox.invalid), so nothing is shared
 * with any other visitor or real workspace, and no email can ever leave.
 */
export async function createSandbox(ip: string | null): Promise<{ tenant: Tenant; projectId: string; agencyUserId: string }> {
  const ipHash = hmac(config().SECRET_KEY, `demo-ip:${ip ?? "unknown"}`);
  const load = await one<{ mine: string; active: string }>(
    `select count(*) filter (where sandbox_ip_hash = $1 and created_at > now() - interval '1 hour') as mine,
            count(*) filter (where sandbox_expires_at > now()) as active
     from tenant where sandbox_expires_at is not null`,
    [ipHash],
  );
  if (Number(load?.mine ?? 0) >= MAX_PER_IP_PER_HOUR || Number(load?.active ?? 0) >= MAX_ACTIVE_SANDBOXES) {
    throw new DemoUnavailable();
  }

  const id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  const { tenantId, userId } = await createTenant({
    slug: `demo-${id}`,
    name: "Demo Consulting",
    adminEmail: `consultant-${id}@sandbox.invalid`,
    adminName: "Alex Morgan (you)",
  });
  await query(
    `update tenant set sandbox_expires_at = now() + make_interval(hours => $2), sandbox_ip_hash = $3 where id = $1`,
    [tenantId, SANDBOX_HOURS, ipHash],
  );
  const tenant = (await getTenantById(tenantId))!;

  const project = await createProject({
    tenantId,
    actorUserId: userId,
    input: { name: "E-commerce replatform", clientName: "Northwind Retail", reference: "SOW-2026-014", currency: "GBP" },
  });
  if (!project.ok) throw new Error(project.error);
  const projectId = project.projectId;
  const ctx = { tenantId, projectId, actorUserId: userId };

  for (const item of ITEMS) {
    const r = await saveItem({ ...ctx, input: item });
    if (!r.ok) throw new Error(r.error);
  }
  const v1 = await publishBaseline(ctx);
  if (!v1.ok) throw new Error("Couldn't publish the demo scope");

  const invited = await inviteClient({
    tenant,
    projectId,
    actorUserId: userId,
    input: { email: `client-${id}@sandbox.invalid`, name: "Sam Rivera (Northwind)", role: "approver" },
  });
  if (!invited.ok) throw new Error(invited.error);

  // CR-001: assessed and with the client. The visitor approves it in the client view.
  await raiseAndAssess(ctx, {
    title: "Add Apple Pay at checkout",
    requestText: "Our marketing team wants Apple Pay at checkout before the spring campaign. Can we add it?",
    source: "email",
    requestedBy: "Sam Rivera, Head of Digital",
    assessment: {
      affectedKeys: ["CP-01"],
      scopeChange: "Add Apple Pay as a second way to pay at checkout, through the same payment provider.",
      effortMinDays: "4",
      effortMaxDays: "6",
      price: "4800",
      pricingBasis: "fixed",
      scheduleDays: "3",
      assumptions: "Northwind's Apple Pay merchant account is approved by week 5.",
      risks: "Apple's domain verification can take a few days.",
    },
    send: true,
  });

  // CR-002: just logged. The visitor assesses it and sends it.
  const cr2 = await raiseChangeRequest({
    ...ctx,
    input: {
      title: "Gift wrapping option",
      requestText: "Could customers choose gift wrapping and add a message at checkout? It's a big ask from our stores team.",
      source: "meeting",
      requestedBy: "Priya Shah, Stores",
      requestedOn: "",
      wantedBy: "",
    },
  });
  if (!cr2.ok) throw new Error(cr2.error);

  // CR-003: assessed, then declined by the client. Shows what a closed change looks like.
  const clientId = (await clientUser(tenantId))!;
  const cr3 = await raiseAndAssess(ctx, {
    title: "Live chat on every page",
    requestText: "Can we add live chat so customers can talk to the service team?",
    source: "call",
    requestedBy: "Sam Rivera, Head of Digital",
    assessment: {
      affectedKeys: [],
      scopeChange: "Add a third-party live chat widget to all pages, with routing to the service team's inbox.",
      effortMinDays: "6",
      effortMaxDays: "9",
      price: "7200",
      pricingBasis: "estimate",
      scheduleDays: "5",
      assumptions: "",
      risks: "",
    },
    send: true,
  });
  const rev = await one<{ id: string }>(
    "select r.id from impact_revision r join change_request c on c.id = r.change_request_id where c.project_id = $1 and c.number = $2",
    [projectId, cr3],
  );
  await decideChange({
    tenant,
    projectId,
    number: cr3,
    userId: clientId,
    revisionId: rev!.id,
    outcome: "rejected",
    authorityConfirmed: false,
    comment: "Not this phase. Let's revisit after launch.",
    ip: null,
    userAgent: "demo-setup",
  });

  return { tenant, projectId, agencyUserId: userId };
}

async function raiseAndAssess(
  ctx: { tenantId: string; projectId: string; actorUserId: string },
  cr: { title: string; requestText: string; source: string; requestedBy: string; assessment: Record<string, unknown>; send: boolean },
): Promise<number> {
  const raised = await raiseChangeRequest({
    ...ctx,
    input: { title: cr.title, requestText: cr.requestText, source: cr.source, requestedBy: cr.requestedBy, requestedOn: "", wantedBy: "" },
  });
  if (!raised.ok) throw new Error(raised.error);
  const saved = await saveImpactDraft({ ...ctx, number: raised.number, input: cr.assessment });
  if (!saved.ok) throw new Error(saved.error);
  if (cr.send) {
    const sent = await publishAssessment({ ...ctx, number: raised.number });
    if (!sent.ok) throw new Error(sent.errors.join("; "));
  }
  return raised.number;
}

export const isDemoUnavailable = (e: unknown) => e instanceof DemoUnavailable;

async function clientUser(tenantId: string): Promise<string | null> {
  const r = await one<{ user_id: string }>(
    "select user_id from project_access where tenant_id = $1 and role = 'approver' and status = 'active' order by invited_at limit 1",
    [tenantId],
  );
  return r?.user_id ?? null;
}

async function agencyUserId(tenantId: string): Promise<string | null> {
  const r = await one<{ user_id: string }>(
    "select user_id from membership where tenant_id = $1 and role = 'admin' and status = 'active' order by created_at limit 1",
    [tenantId],
  );
  return r?.user_id ?? null;
}

/** Signs the visitor in as the sandbox's consultant or its client approver. Sandboxes only. */
export async function demoSession(tenant: Tenant, role: DemoRole) {
  if (!tenant.sandbox) throw new Error("Not a demo workspace");
  const userId = role === "agency" ? await agencyUserId(tenant.id) : await clientUser(tenant.id);
  if (!userId) throw new Error("Demo user missing");
  return openSession(tenant.id, userId, role === "agency" ? "demo.viewed_as_agency" : "demo.viewed_as_client");
}

export type DemoStep = { n: number; of: number; role: DemoRole; text: string; href: string; done?: boolean };

/** The guided path through the demo, worked out from where the visitor has got to. */
export async function demoGuide(tenantId: string): Promise<DemoStep | null> {
  const p = await one<{ id: string }>("select id from project where tenant_id = $1 order by created_at limit 1", [tenantId]);
  if (!p) return null;
  const rows = await query<{ number: number; status: string }>(
    "select number, status from change_request where project_id = $1 and number in (1, 2)",
    [p.id],
  );
  const st = (n: number) => rows.find((r) => r.number === n)?.status;
  const base = `/projects/${p.id}`;
  const of = 4;
  const s1 = st(1);
  const s2 = st(2);
  if (s1 === "awaiting_client") {
    return { n: 1, of, role: "client", text: "Approve CR-001 (Apple Pay) as the client, Sam at Northwind.", href: `/portal/changes/${p.id}/1` };
  }
  if (s1 === "approved") {
    return { n: 2, of, role: "agency", text: "Put the approved change into the agreed scope: edit CP-01 in the draft, then publish version 2.", href: `${base}/scope` };
  }
  if (s2 === "submitted" || s2 === "assessing") {
    return { n: 3, of, role: "agency", text: "Assess CR-002 (gift wrapping): fill in the impact, save, then send it to the client.", href: `${base}/changes/2` };
  }
  if (s2 === "awaiting_client") {
    return { n: 4, of, role: "client", text: "As the client, review CR-002, ask a question or decide.", href: `/portal/changes/${p.id}/2` };
  }
  return { n: of, of, role: "agency", text: "You've been round the whole loop. Explore freely, or create a project of your own.", href: "/", done: true };
}
