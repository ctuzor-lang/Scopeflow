import { describe, expect, it } from "vitest";
import { requestSignInCode, userForSession, verifySignInCode } from "../src/lib/auth";
import { publishBaseline } from "../src/lib/baselines";
import { getChangeRequest, listRevisions, publishAssessment, raiseChangeRequest, saveImpactDraft } from "../src/lib/changes";
import { clientProjects, clientRole, inviteClient, revokeClient, listClientAccess } from "../src/lib/clients";
import { query } from "../src/lib/db";
import { addComment, decideChange, getDecision, listComments, notifyDecisionNeeded } from "../src/lib/decisions";
import { createProject } from "../src/lib/projects";
import { saveItem } from "../src/lib/scope";
import { lastCodeFor, makeTenant, sentMail } from "./helpers";

const draft = {
  affectedKeys: ["CP-03"],
  scopeChange: "Checkout accepts one gift card plus one card.",
  effortMinDays: "9",
  effortMaxDays: "12",
  price: "14,200",
  pricingBasis: "fixed",
  scheduleDays: "10",
  assumptions: "",
  risks: "",
};

/** A project with v1, CR-001 published as R1, and a client approver and viewer. */
async function setup() {
  const t = await makeTenant();
  const pr = await createProject({ tenantId: t.tenantId, actorUserId: t.userId, input: { name: "OMS", clientName: "Northwind Retail", reference: "", currency: "GBP" } });
  if (!pr.ok) throw new Error(pr.error);
  const projectId = pr.projectId;
  await saveItem({ tenantId: t.tenantId, projectId, actorUserId: t.userId, input: { key: "CP-03", kind: "requirement", section: "", title: "Card payments", description: "", acceptanceCriteria: "" } });
  await publishBaseline({ tenantId: t.tenantId, projectId, actorUserId: t.userId });
  await raiseChangeRequest({ tenantId: t.tenantId, projectId, actorUserId: t.userId, input: { title: "Split tender", requestText: "Gift cards please", source: "email", requestedBy: "", requestedOn: "", wantedBy: "" } });
  await saveImpactDraft({ tenantId: t.tenantId, projectId, number: 1, actorUserId: t.userId, input: draft });
  await publishAssessment({ tenantId: t.tenantId, projectId, number: 1, actorUserId: t.userId });
  const suffix = Math.random().toString(36).slice(2, 8);
  const approverEmail = `jas-${suffix}@northwind.example`;
  const viewerEmail = `sam-${suffix}@northwind.example`;
  expect(await inviteClient({ tenant: t.tenant, projectId, actorUserId: t.userId, input: { email: approverEmail, name: "Jas Patel", role: "approver" } })).toEqual({ ok: true });
  expect(await inviteClient({ tenant: t.tenant, projectId, actorUserId: t.userId, input: { email: viewerEmail, name: "Sam Lee", role: "viewer" } })).toEqual({ ok: true });
  const access = await listClientAccess(t.tenantId, projectId);
  const approverId = access.find((a) => a.email === approverEmail)!.userId;
  const viewerId = access.find((a) => a.email === viewerEmail)!.userId;
  const cr = (await getChangeRequest(t.tenantId, projectId, 1))!;
  const r1 = (await listRevisions(cr.id))[0];
  return { ...t, projectId, approverEmail, viewerEmail, approverId, viewerId, cr, r1 };
}

const decide = (s: Awaited<ReturnType<typeof setup>>, over: Partial<Parameters<typeof decideChange>[0]> = {}) =>
  decideChange({
    tenant: s.tenant,
    projectId: s.projectId,
    number: 1,
    userId: s.approverId,
    revisionId: s.r1.id,
    outcome: "approved",
    authorityConfirmed: true,
    comment: null,
    ip: "127.0.0.1",
    userAgent: "test",
    ...over,
  });

describe("client access", () => {
  it("invites by email and lets the client sign in as a client, not an agency member", async () => {
    const s = await setup();
    const invite = sentMail.filter((m) => m.to === s.approverEmail).at(-1)!;
    expect(invite.text).toContain("/login");
    expect(invite.text).not.toMatch(/14,200/);
    await requestSignInCode(s.tenant, s.approverEmail, null);
    const r = await verifySignInCode(s.tenant, s.approverEmail, lastCodeFor(s.approverEmail), null);
    if (!r.ok) throw new Error("client sign-in failed");
    const user = await userForSession(s.tenant, r.sessionToken);
    expect(user).toMatchObject({ kind: "client", role: "client", email: s.approverEmail });
  });

  it("refuses to invite someone who is already an agency member", async () => {
    const s = await setup();
    expect(await inviteClient({ tenant: s.tenant, projectId: s.projectId, actorUserId: s.userId, input: { email: s.adminEmail, name: "Me", role: "approver" } })).toMatchObject({ ok: false });
  });

  it("revoking access ends the client's session and sign-in", async () => {
    const s = await setup();
    await requestSignInCode(s.tenant, s.viewerEmail, null);
    const r = await verifySignInCode(s.tenant, s.viewerEmail, lastCodeFor(s.viewerEmail), null);
    if (!r.ok) throw new Error("sign-in failed");
    const access = (await listClientAccess(s.tenantId, s.projectId)).find((a) => a.email === s.viewerEmail)!;
    await revokeClient({ tenantId: s.tenantId, projectId: s.projectId, accessId: access.id, actorUserId: s.userId });
    expect(await userForSession(s.tenant, r.sessionToken)).toBeNull();
    const before = sentMail.length;
    await requestSignInCode(s.tenant, s.viewerEmail, null);
    expect(sentMail.length).toBe(before);
  });

  it("a client sees only the projects they were given", async () => {
    const s = await setup();
    const other = await createProject({ tenantId: s.tenantId, actorUserId: s.userId, input: { name: "Other", clientName: "Someone Else", reference: "", currency: "GBP" } });
    if (!other.ok) throw new Error("project");
    expect(await clientRole(s.tenantId, s.projectId, s.approverId)).toBe("approver");
    expect(await clientRole(s.tenantId, other.projectId, s.approverId)).toBeNull();
    const projects = await clientProjects(s.tenantId, s.approverId);
    expect(new Set(projects.map((p) => p.project_id))).toEqual(new Set([s.projectId]));
    expect(projects[0]).toMatchObject({ number: 1, status: "awaiting_client" });
  });

  it("emails clients when a decision is needed, without the figures", async () => {
    const s = await setup();
    await notifyDecisionNeeded(s.tenant, s.projectId, 1, "Split tender", 1);
    const mail = sentMail.filter((m) => m.to === s.approverEmail).at(-1)!;
    expect(mail.subject).toContain("Decision needed: CR-001");
    expect(mail.text).toContain(`/portal/changes/${s.projectId}/1`);
    expect(mail.text).not.toMatch(/14,200|£/);
  });
});

describe("client decisions", () => {
  it("an approver approves the exact revision with an authority statement", async () => {
    const s = await setup();
    expect(await decide(s)).toEqual({ ok: true });
    expect((await getChangeRequest(s.tenantId, s.projectId, 1))?.status).toBe("approved");
    const d = (await getDecision(s.cr.id))!;
    expect(d).toMatchObject({ outcome: "approved", revNo: 1, revisionDigest: s.r1.digest, decidedBy: s.approverEmail });
    expect(d.authorityStatement).toContain("I confirm I am authorised by Northwind Retail");
    expect(d.authorityStatement).toContain("This varies the agreed scope under the change control terms");
    expect(d.authorityStatement).toMatch(/fingerprint [0-9a-f]{12}/);
    expect(d.authorityStatement).toContain("CR-001 as set out in assessment R1");
    expect(d.authorityStatement).toContain("£14,200");
    expect(sentMail.some((m) => m.to === s.adminEmail && m.subject.startsWith("CR-001 approved"))).toBe(true);
  });

  it("a viewer can't decide", async () => {
    const s = await setup();
    expect(await decide(s, { userId: s.viewerId })).toMatchObject({ ok: false, reason: "not_approver" });
  });

  it("an agency member can't approve on the client's behalf", async () => {
    const s = await setup();
    expect(await decide(s, { userId: s.userId })).toMatchObject({ ok: false, reason: "not_approver" });
  });

  it("approval needs the authority confirmation; declining doesn't", async () => {
    const s = await setup();
    expect(await decide(s, { authorityConfirmed: false })).toMatchObject({ ok: false, reason: "authority_required" });
    expect(await decide(s, { outcome: "rejected", authorityConfirmed: false, comment: "Not this quarter" })).toEqual({ ok: true });
    expect((await getDecision(s.cr.id))).toMatchObject({ outcome: "rejected", comment: "Not this quarter", authorityStatement: null });
  });

  it("refuses a decision on a stale revision (AC-04)", async () => {
    const s = await setup();
    await saveImpactDraft({ tenantId: s.tenantId, projectId: s.projectId, number: 1, actorUserId: s.userId, input: { ...draft, price: "15,000" } });
    await publishAssessment({ tenantId: s.tenantId, projectId: s.projectId, number: 1, actorUserId: s.userId });
    expect(await decide(s)).toMatchObject({ ok: false, reason: "stale" });
    const r2 = (await listRevisions(s.cr.id))[0];
    expect(await decide(s, { revisionId: r2.id })).toEqual({ ok: true });
    expect((await getDecision(s.cr.id))?.revNo).toBe(2);
  });

  it("allows one decision only, and the record can't be changed", async () => {
    const s = await setup();
    expect(await decide(s)).toEqual({ ok: true });
    expect(await decide(s, { outcome: "rejected" })).toMatchObject({ ok: false, reason: "not_awaiting" });
    await expect(query("update change_decision set outcome = 'rejected' where change_request_id = $1", [s.cr.id])).rejects.toThrow(/immutable/);
    await expect(query("delete from change_decision where change_request_id = $1", [s.cr.id])).rejects.toThrow(/immutable/);
  });

  it("the agency can't reassess once the client has decided", async () => {
    const s = await setup();
    await decide(s);
    expect(await saveImpactDraft({ tenantId: s.tenantId, projectId: s.projectId, number: 1, actorUserId: s.userId, input: draft })).toMatchObject({ ok: false });
  });

  it("a client from another tenant can't decide", async () => {
    const s = await setup();
    const other = await makeTenant();
    expect(await decideChange({ tenant: other.tenant, projectId: s.projectId, number: 1, userId: s.approverId, revisionId: s.r1.id, outcome: "approved", authorityConfirmed: true, comment: null, ip: null, userAgent: null })).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("questions", () => {
  it("client and agency exchange messages; emails carry no message text", async () => {
    const s = await setup();
    expect(await addComment({ tenant: s.tenant, projectId: s.projectId, number: 1, userId: s.approverId, side: "client", body: "Could this be online only?" })).toEqual({ ok: true });
    expect(await addComment({ tenant: s.tenant, projectId: s.projectId, number: 1, userId: s.userId, side: "agency", body: "Yes, tills stay out of scope." })).toEqual({ ok: true });
    const thread = await listComments(s.cr.id);
    expect(thread.map((c) => [c.side, c.body])).toEqual([
      ["client", "Could this be online only?"],
      ["agency", "Yes, tills stay out of scope."],
    ]);
    const toAgency = sentMail.filter((m) => m.to === s.adminEmail && m.subject.startsWith("New question")).at(-1)!;
    expect(toAgency.text).not.toContain("online only");
    const toClient = sentMail.filter((m) => m.to === s.approverEmail && m.subject.includes("replied")).at(-1)!;
    expect(toClient.text).not.toContain("tills");
    expect(await addComment({ tenant: s.tenant, projectId: s.projectId, number: 1, userId: s.approverId, side: "client", body: "  " })).toMatchObject({ ok: false });
  });
});
