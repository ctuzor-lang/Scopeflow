import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changesAwaitingIncorporation, changesInBaseline, getBaseline, publishBaseline, versionIncludingChange } from "../src/lib/baselines";
import { changeNoteData, renderChangeNote } from "../src/lib/changeNote";
import { getChangeRequest, listRevisions, publishAssessment, raiseChangeRequest, saveImpactDraft } from "../src/lib/changes";
import { inviteClient, listClientAccess } from "../src/lib/clients";
import { query } from "../src/lib/db";
import { addComment, decideChange } from "../src/lib/decisions";
import { createProject } from "../src/lib/projects";
import { draftItems, saveItem } from "../src/lib/scope";
import { makeTenant } from "./helpers";

async function approvedChange() {
  const t = await makeTenant();
  const pr = await createProject({ tenantId: t.tenantId, actorUserId: t.userId, input: { name: "OMS", clientName: "Northwind Retail", reference: "SOW-2026-014", currency: "GBP" } });
  if (!pr.ok) throw new Error(pr.error);
  const projectId = pr.projectId;
  await saveItem({ tenantId: t.tenantId, projectId, actorUserId: t.userId, input: { key: "CP-03", kind: "requirement", section: "", title: "Card payments through one provider", description: "", acceptanceCriteria: "" } });
  await publishBaseline({ tenantId: t.tenantId, projectId, actorUserId: t.userId });
  await raiseChangeRequest({ tenantId: t.tenantId, projectId, actorUserId: t.userId, input: { title: "Split-tender payment", requestText: "Gift card plus card please", source: "email", requestedBy: "Jas Patel", requestedOn: "", wantedBy: "" } });
  await saveImpactDraft({
    tenantId: t.tenantId, projectId, number: 1, actorUserId: t.userId,
    input: { affectedKeys: ["CP-03"], scopeChange: "Checkout accepts one gift card plus one card.", effortMinDays: "9", effortMaxDays: "12", price: "13,800", pricingBasis: "fixed", scheduleDays: "10", assumptions: "Tills out of scope.", risks: "" },
  });
  await publishAssessment({ tenantId: t.tenantId, projectId, number: 1, actorUserId: t.userId });
  const email = `jas-${Math.random().toString(36).slice(2, 8)}@northwind.example`;
  await inviteClient({ tenant: t.tenant, projectId, actorUserId: t.userId, input: { email, name: "Jas Patel", role: "approver" } });
  const approverId = (await listClientAccess(t.tenantId, projectId))[0].userId;
  const cr = (await getChangeRequest(t.tenantId, projectId, 1))!;
  await addComment({ tenant: t.tenant, projectId, number: 1, userId: approverId, side: "client", body: "Online only?" });
  const r1 = (await listRevisions(cr.id))[0];
  const d = await decideChange({ tenant: t.tenant, projectId, number: 1, userId: approverId, revisionId: r1.id, outcome: "approved", authorityConfirmed: true, comment: null, ip: null, userAgent: null });
  expect(d).toEqual({ ok: true });
  return { ...t, projectId, cr };
}

describe("putting approved changes into a new version", () => {
  it("links the change to the version that includes it and marks it incorporated", async () => {
    const s = await approvedChange();
    expect((await changesAwaitingIncorporation(s.tenantId, s.projectId)).map((c) => c.number)).toEqual([1]);
    const item = (await draftItems(s.tenantId, s.projectId))[0];
    await saveItem({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, itemId: item.id, input: { key: "", kind: "requirement", section: "", title: "Card and gift card payments", description: "", acceptanceCriteria: "" } });
    expect(await publishBaseline({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, includesChanges: [1] })).toMatchObject({ ok: true, version: 2 });
    expect((await getChangeRequest(s.tenantId, s.projectId, 1))?.status).toBe("incorporated");
    expect(await versionIncludingChange(s.cr.id)).toBe(2);
    const v2 = (await getBaseline(s.tenantId, s.projectId, 2))!;
    expect((await changesInBaseline(v2.id)).map((c) => c.number)).toEqual([1]);
    expect(await changesAwaitingIncorporation(s.tenantId, s.projectId)).toEqual([]);
    await expect(query("delete from baseline_change where baseline_id = $1", [v2.id])).rejects.toThrow(/immutable/);
  });

  it("refuses to include a change that isn't approved", async () => {
    const s = await approvedChange();
    await raiseChangeRequest({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, input: { title: "Not decided", requestText: "x", source: "call", requestedBy: "", requestedOn: "", wantedBy: "" } });
    const item = (await draftItems(s.tenantId, s.projectId))[0];
    await saveItem({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, itemId: item.id, input: { key: "", kind: "requirement", section: "", title: "Changed", description: "", acceptanceCriteria: "" } });
    expect(await publishBaseline({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, includesChanges: [1, 2] })).toMatchObject({ ok: false, error: expect.stringContaining("CR-002") });
    expect((await getChangeRequest(s.tenantId, s.projectId, 1))?.status).toBe("approved");
  });

  it("allows a version that only records a change with no scope edits (e.g. schedule only)", async () => {
    const s = await approvedChange();
    expect(await publishBaseline({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId })).toMatchObject({ ok: false });
    expect(await publishBaseline({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, includesChanges: [1] })).toMatchObject({ ok: true, version: 2 });
  });
});

describe("change control note", () => {
  it("is only available once the client has decided", async () => {
    const t = await makeTenant();
    expect(await changeNoteData(t.tenant, "00000000-0000-4000-8000-000000000000", 1)).toBeNull();
  });

  it("renders a PDF with the request, figures, decision wording and history", async () => {
    const s = await approvedChange();
    await publishBaseline({ tenantId: s.tenantId, projectId: s.projectId, actorUserId: s.userId, includesChanges: [1] });
    const data = (await changeNoteData(s.tenant, s.projectId, 1))!;
    expect(data.history.map((h) => h.text)).toEqual([
      expect.stringMatching(/^Change request logged by/),
      expect.stringMatching(/^Assessment R1 sent to the client by/),
      "Question from Jas Patel",
      "Approved by Jas Patel (R1)",
      "Put into effect in agreed version 2",
    ]);
    const pdf = await renderChangeNote(data, new Date("2026-11-06T12:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const dir = mkdtempSync(join(tmpdir(), "ccn-"));
    writeFileSync(join(dir, "n.pdf"), pdf);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
    const text = execFileSync("pdftotext", ["-layout", join(dir, "n.pdf"), "-"]).toString().replace(/\s+/g, " ");
    for (const expected of [
      "CHANGE CONTROL NOTE",
      "Split-tender payment",
      "Northwind Retail",
      "SOW-2026-014",
      "£13,800 excl. VAT",
      "9–12 days",
      "+10 working days",
      "on behalf of Northwind Retail",
      "Put into effect in agreed version 2",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("another tenant gets nothing", async () => {
    const s = await approvedChange();
    const other = await makeTenant();
    expect(await changeNoteData(other.tenant, s.projectId, 1)).toBeNull();
  });
});
