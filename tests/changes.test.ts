import { describe, expect, it } from "vitest";
import { publishBaseline } from "../src/lib/baselines";
import {
  assessmentDigest,
  formatMoney,
  getChangeRequest,
  getImpactDraft,
  listChangeRequests,
  listRevisions,
  parseMoney,
  publishAssessment,
  raiseChangeRequest,
  saveImpactDraft,
  withdrawChange,
} from "../src/lib/changes";
import { query } from "../src/lib/db";
import { createProject } from "../src/lib/projects";
import { saveItem } from "../src/lib/scope";
import { makeTenant } from "./helpers";

async function projectWithVersion() {
  const t = await makeTenant();
  const r = await createProject({ tenantId: t.tenantId, actorUserId: t.userId, input: { name: "OMS", clientName: "Northwind", reference: "", currency: "GBP" } });
  if (!r.ok) throw new Error(r.error);
  for (const [key, title] of [["CP-03", "Card payments through one provider"], ["CP-07", "Refunds to original method"], ["ERP-04", "One payment line per order"]]) {
    await saveItem({ tenantId: t.tenantId, projectId: r.projectId, actorUserId: t.userId, input: { key, kind: "requirement", section: "", title, description: "", acceptanceCriteria: "" } });
  }
  await publishBaseline({ tenantId: t.tenantId, projectId: r.projectId, actorUserId: t.userId });
  return { ...t, projectId: r.projectId };
}

const raise = (p: { tenantId: string; projectId: string; userId: string }, title = "Split-tender payment") =>
  raiseChangeRequest({
    tenantId: p.tenantId,
    projectId: p.projectId,
    actorUserId: p.userId,
    input: { title, requestText: "Can customers pay part by gift card?", source: "email", requestedBy: "J. Patel", requestedOn: "2026-11-03", wantedBy: "" },
  });

const fullDraft = {
  affectedKeys: ["CP-03", "cp-07"],
  scopeChange: "Checkout accepts one gift card plus one card.",
  effortMinDays: "9",
  effortMaxDays: "12",
  price: "£14,200",
  pricingBasis: "fixed",
  scheduleDays: "10",
  assumptions: "Provider supports split tender.",
  risks: "",
};

describe("money", () => {
  it("parses and formats prices", () => {
    expect(parseMoney("£14,200")).toBe(1420000);
    expect(parseMoney("99.5")).toBe(9950);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("12.345")).toBeUndefined();
    expect(parseMoney("abc")).toBeUndefined();
    expect(formatMoney(1420000, "GBP")).toBe("£14,200");
  });
});

describe("change requests", () => {
  it("needs a published version to raise against, then numbers changes per project", async () => {
    const t = await makeTenant();
    const r = await createProject({ tenantId: t.tenantId, actorUserId: t.userId, input: { name: "Empty", clientName: "C", reference: "", currency: "GBP" } });
    if (!r.ok) throw new Error(r.error);
    expect(await raise({ ...t, projectId: r.projectId })).toMatchObject({ ok: false });

    const p = await projectWithVersion();
    expect(await raise(p)).toEqual({ ok: true, number: 1 });
    expect(await raise(p, "Another")).toEqual({ ok: true, number: 2 });
    const cr = await getChangeRequest(p.tenantId, p.projectId, 1);
    expect(cr).toMatchObject({ ref: "CR-001", status: "submitted", sourceVersion: 1, requestedOn: "2026-11-03" });
  });

  it("saving an assessment moves it to assessing and accepts partial work", async () => {
    const p = await projectWithVersion();
    await raise(p);
    const r = await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: { ...fullDraft, effortMaxDays: "", price: "" } });
    expect(r).toEqual({ ok: true });
    expect((await getChangeRequest(p.tenantId, p.projectId, 1))?.status).toBe("assessing");
    expect((await getImpactDraft((await getChangeRequest(p.tenantId, p.projectId, 1))!.id)).affectedKeys).toEqual(["CP-03", "CP-07"]);
  });

  it("only links items from the version the change was raised against", async () => {
    const p = await projectWithVersion();
    await raise(p);
    const r = await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: { ...fullDraft, affectedKeys: ["NOPE-1"] } });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("NOPE-1") });
  });

  it("refuses to publish an incomplete assessment and lists what's missing", async () => {
    const p = await projectWithVersion();
    await raise(p);
    await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: { ...fullDraft, scopeChange: "", effortMinDays: "12", effortMaxDays: "9", price: "", scheduleDays: "" } });
    const r = await publishAssessment({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Describe what changes/);
    expect(r.errors.join(" ")).toMatch(/minimum effort can't be more/);
    expect(r.errors.join(" ")).toMatch(/Enter the price/);
    expect(r.errors.join(" ")).toMatch(/schedule impact/);
  });

  it("publishes R1 for the client, keeps it frozen, and R2 supersedes it", async () => {
    const p = await projectWithVersion();
    await raise(p);
    await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: fullDraft });
    expect(await publishAssessment({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId })).toEqual({ ok: true, revNo: 1 });
    const cr = (await getChangeRequest(p.tenantId, p.projectId, 1))!;
    expect(cr.status).toBe("awaiting_client");

    expect(await publishAssessment({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId })).toMatchObject({ ok: false });

    await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: { ...fullDraft, price: "15,000" } });
    expect(await publishAssessment({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId })).toEqual({ ok: true, revNo: 2 });

    const revs = await listRevisions(cr.id);
    expect(revs.map((r) => [r.revNo, r.payload.price.amountMinor])).toEqual([[2, 1500000], [1, 1420000]]);
    expect(revs[1].payload).toMatchObject({ changeRequest: "CR-001", sourceVersion: 1, affectedItems: [{ key: "CP-03", title: "Card payments through one provider" }, { key: "CP-07", title: "Refunds to original method" }] });
    for (const r of revs) expect(r.digest).toBe(assessmentDigest(cr.id, r.revNo, r.payload));
    await expect(query("update impact_revision set payload = '{}' where change_request_id = $1", [cr.id])).rejects.toThrow(/immutable/);

    const list = await listChangeRequests(p.tenantId, p.projectId);
    expect(list[0]).toMatchObject({ ref: "CR-001", latestRev: 2 });
  });

  it("no-charge changes publish without a price", async () => {
    const p = await projectWithVersion();
    await raise(p);
    await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: { ...fullDraft, price: "", pricingBasis: "no_charge", scheduleDays: "0" } });
    expect(await publishAssessment({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId })).toEqual({ ok: true, revNo: 1 });
  });

  it("a withdrawn change can't be reassessed", async () => {
    const p = await projectWithVersion();
    await raise(p);
    expect(await withdrawChange({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, reason: "" })).toMatchObject({ ok: false });
    expect(await withdrawChange({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, reason: "Client dropped it" })).toEqual({ ok: true });
    expect(await saveImpactDraft({ tenantId: p.tenantId, projectId: p.projectId, number: 1, actorUserId: p.userId, input: fullDraft })).toMatchObject({ ok: false });
  });

  it("another tenant can't see or touch a change", async () => {
    const p = await projectWithVersion();
    const other = await makeTenant();
    await raise(p);
    expect(await getChangeRequest(other.tenantId, p.projectId, 1)).toBeNull();
    expect(await listChangeRequests(other.tenantId, p.projectId)).toEqual([]);
    expect(await saveImpactDraft({ tenantId: other.tenantId, projectId: p.projectId, number: 1, actorUserId: other.userId, input: fullDraft })).toMatchObject({ ok: false });
    expect(await raise({ ...other, projectId: p.projectId })).toMatchObject({ ok: false, error: "Project not found" });
  });
});
