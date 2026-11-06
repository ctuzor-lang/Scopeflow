import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  baselineItems,
  draftChanges,
  getBaseline,
  listBaselines,
  publishBaseline,
  verifyBaseline,
} from "../src/lib/baselines";
import { query } from "../src/lib/db";
import { parseCsv, parseScopeFile, rowsToScope } from "../src/lib/importer";
import { createProject, getProject } from "../src/lib/projects";
import { draftItems, importRows, removeItem, saveItem } from "../src/lib/scope";
import { makeTenant } from "./helpers";

async function newProject() {
  const t = await makeTenant();
  const r = await createProject({
    tenantId: t.tenantId,
    actorUserId: t.userId,
    input: { name: "Order Management", clientName: "Northwind Retail", reference: "SOW-1", currency: "gbp" },
  });
  if (!r.ok) throw new Error(r.error);
  return { ...t, projectId: r.projectId };
}

const CSV = [
  "Ref,Section,Type,Title,Description,Acceptance criteria",
  'CP-03,Checkout,Requirement,"Card payments, one provider","Single tender per order",Works in test mode',
  "CP-07,Checkout,Requirement,Refunds to original method,,",
  "AS-01,Assumptions,Assumption,Client provides sandbox,,",
  "EX-01,Exclusions,Out of scope,In-store tills,,",
].join("\n");

describe("spreadsheet import", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("matches column names loosely and maps types", async () => {
    const r = await parseScopeFile("scope.csv", Buffer.from(CSV));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({ key: "CP-03", title: "Card payments, one provider", kind: "requirement", section: "Checkout" });
    expect(r.rows[3].kind).toBe("exclusion");
  });

  it("reads Excel files", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scope");
    ws.addRow(["ID", "Requirement", "Area"]);
    ws.addRow(["req 1", "Single sign-on", "Platform"]);
    ws.addRow([null, "Audit export", "Platform"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseScopeFile("scope.xlsx", buf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => [x.key, x.title, x.section])).toEqual([
      ["REQ-1", "Single sign-on", "Platform"],
      [null, "Audit export", "Platform"],
    ]);
  });

  it("reports every problem and imports nothing when rows are invalid", () => {
    const r = rowsToScope([
      ["Ref", "Title", "Type"],
      ["A1", "", ""],
      ["A2", "Fine", "banana"],
      ["A2", "Duplicate", ""],
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Row 2: the title is empty/);
    expect(r.errors.join(" ")).toMatch(/Row 3: type "banana"/);
    expect(r.errors.join(" ")).toMatch(/Row 4: reference A2 is also used on row 3/);
  });

  it("needs a title column", () => {
    const r = rowsToScope([["Ref", "Notes"], ["A", "B"]]);
    expect(r.ok).toBe(false);
  });
});

describe("draft and baselines", () => {
  it("imports into the draft and re-importing updates by reference", async () => {
    const p = await newProject();
    const parsed = await parseScopeFile("s.csv", Buffer.from(CSV));
    if (!parsed.ok) throw new Error("parse");
    const first = await importRows({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, rows: parsed.rows, fileName: "s.csv" });
    expect(first).toEqual({ added: 4, updated: 0, unchanged: 0, restored: 0 });
    const changed = parsed.rows.map((r) => (r.key === "CP-07" ? { ...r, title: "Refunds across both tenders" } : r));
    const second = await importRows({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, rows: changed, fileName: "s.csv" });
    expect(second).toEqual({ added: 0, updated: 1, unchanged: 3, restored: 0 });
    const items = await draftItems(p.tenantId, p.projectId);
    expect(items.find((i) => i.key === "CP-07")).toMatchObject({ title: "Refunds across both tenders", revNo: 2 });
  });

  it("numbers items that have no reference", async () => {
    const p = await newProject();
    const a = await saveItem({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, input: { key: "", kind: "deliverable", section: "", title: "Handover pack", description: "", acceptanceCriteria: "" } });
    expect(a).toEqual({ ok: true, key: "ITEM-001" });
  });

  it("refuses a duplicate reference when adding by hand", async () => {
    const p = await newProject();
    const input = { key: "X-1", kind: "requirement", section: "", title: "One", description: "", acceptanceCriteria: "" };
    expect((await saveItem({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, input })).ok).toBe(true);
    expect(await saveItem({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, input })).toMatchObject({ ok: false });
  });

  it("publishes version 1 with a stable fingerprint, then version 2 only when something changed", async () => {
    const p = await newProject();
    const parsed = await parseScopeFile("s.csv", Buffer.from(CSV));
    if (!parsed.ok) throw new Error("parse");
    await importRows({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, rows: parsed.rows, fileName: "s.csv" });

    const v1 = await publishBaseline({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId });
    expect(v1).toMatchObject({ ok: true, version: 1 });
    expect(await verifyBaseline(p.tenantId, p.projectId, 1)).toBe(true);

    const again = await publishBaseline({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId });
    expect(again).toEqual({ ok: false, error: "Nothing has changed since version 1." });

    // Edit after publishing (AC-02 / T-001): version 1 must not change.
    const items = await draftItems(p.tenantId, p.projectId);
    const cp03 = items.find((i) => i.key === "CP-03")!;
    await saveItem({
      tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, itemId: cp03.id,
      input: { key: "", kind: "requirement", section: "Checkout", title: "Card and gift card payments", description: "Up to two tenders", acceptanceCriteria: "" },
    });
    await removeItem({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, itemId: items.find((i) => i.key === "AS-01")!.id });

    const pending = await draftChanges(p.tenantId, p.projectId);
    expect(pending.diff.changed.map((c) => c.after.key)).toEqual(["CP-03"]);
    expect(pending.diff.removed.map((r) => r.key)).toEqual(["AS-01"]);

    const b1 = (await getBaseline(p.tenantId, p.projectId, 1))!;
    const v1Items = await baselineItems(b1.id);
    expect(v1Items.find((i) => i.key === "CP-03")?.title).toBe("Card payments, one provider");
    expect(v1Items.map((i) => i.key)).toContain("AS-01");

    const v2 = await publishBaseline({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId });
    expect(v2).toMatchObject({ ok: true, version: 2 });
    expect(await verifyBaseline(p.tenantId, p.projectId, 1)).toBe(true);
    expect(await verifyBaseline(p.tenantId, p.projectId, 2)).toBe(true);
    expect((await listBaselines(p.tenantId, p.projectId)).map((b) => b.version)).toEqual([2, 1]);
  });

  it("won't publish an empty draft", async () => {
    const p = await newProject();
    expect(await publishBaseline({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId })).toMatchObject({ ok: false });
  });

  it("blocks any change to published content at the database level", async () => {
    const p = await newProject();
    await saveItem({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId, input: { key: "A", kind: "requirement", section: "", title: "T", description: "", acceptanceCriteria: "" } });
    await publishBaseline({ tenantId: p.tenantId, projectId: p.projectId, actorUserId: p.userId });
    const b = (await getBaseline(p.tenantId, p.projectId, 1))!;
    await expect(query("update baseline_item set payload = '{}' where baseline_id = $1", [b.id])).rejects.toThrow(/immutable/);
    await expect(query("delete from baseline_item where baseline_id = $1", [b.id])).rejects.toThrow(/immutable/);
    await expect(query("update baseline set content_digest = 'x' where id = $1", [b.id])).rejects.toThrow(/immutable/);
    await expect(query("delete from baseline where id = $1", [b.id])).rejects.toThrow(/immutable/);
    await expect(query("update requirement_revision set title = 'x' where tenant_id = $1", [p.tenantId])).rejects.toThrow(/append-only/);
    // Status may still move (needed for client review in a later slice).
    await query("update baseline set status = 'in_review' where id = $1", [b.id]);
  });
});

describe("project isolation", () => {
  it("another tenant can't see or change a project", async () => {
    const a = await newProject();
    const b = await makeTenant();
    expect(await getProject(b.tenantId, a.projectId)).toBeNull();
    expect(await draftItems(b.tenantId, a.projectId)).toEqual([]);
    await expect(
      saveItem({ tenantId: b.tenantId, projectId: a.projectId, actorUserId: b.userId, input: { key: "", kind: "requirement", section: "", title: "Sneaky", description: "", acceptanceCriteria: "" } }),
    ).rejects.toThrow(/not found/i);
    expect(await publishBaseline({ tenantId: b.tenantId, projectId: a.projectId, actorUserId: b.userId })).toEqual({ ok: false, error: "Project not found" });
  });

  it("the database refuses rows that point across tenants", async () => {
    const a = await newProject();
    const b = await makeTenant();
    await expect(
      query("insert into requirement (tenant_id, project_id, canonical_key) values ($1, $2, 'X')", [b.tenantId, a.projectId]),
    ).rejects.toThrow(/foreign key/);
  });
});
