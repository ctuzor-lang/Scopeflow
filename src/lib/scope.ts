import { z } from "zod";
import { recordAudit } from "./audit";
import { query, tx, type Db } from "./db";
import { KINDS, normaliseKey, type Kind, type ScopeRow } from "./importer";
import { isUuid } from "./projects";

/** An item as it stands in the working draft. */
export type DraftItem = {
  id: string;
  key: string;
  revNo: number;
  kind: Kind;
  section: string | null;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  position: number;
};

type Row = {
  id: string;
  canonical_key: string;
  rev_no: number;
  kind: Kind;
  section: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  position: number;
};

const toItem = (r: Row): DraftItem => ({
  id: r.id,
  key: r.canonical_key,
  revNo: r.rev_no,
  kind: r.kind,
  section: r.section,
  title: r.title,
  description: r.description,
  acceptanceCriteria: r.acceptance_criteria,
  position: r.position,
});

const DRAFT_SELECT = `
  select r.id, r.canonical_key, v.rev_no, v.kind, v.section, v.title, v.description, v.acceptance_criteria, r.position
  from requirement r join requirement_revision v on v.id = r.current_revision_id
  where r.project_id = $1 and r.tenant_id = $2 and r.status = 'active'`;

export async function draftItems(tenantId: string, projectId: string): Promise<DraftItem[]> {
  const rows = await query<Row>(`${DRAFT_SELECT} order by r.position, r.canonical_key`, [projectId, tenantId]);
  return rows.map(toItem);
}

export const itemInput = z.object({
  key: z
    .string()
    .trim()
    .refine((v) => v === "" || normaliseKey(v) !== null, "References can use letters, numbers, - . and _ only (up to 32)")
    .transform((v) => (v ? normaliseKey(v) : null)),
  kind: z.enum(KINDS),
  section: z
    .string()
    .trim()
    .max(120, "Keep the section under 120 characters")
    .transform((v) => v || null),
  title: z.string().trim().min(1, "Enter a title").max(300, "Keep the title under 300 characters"),
  description: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
  acceptanceCriteria: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

type Content = Omit<ScopeRow, "key">;

const sameContent = (a: Content, b: Content) =>
  a.kind === b.kind &&
  (a.section ?? null) === (b.section ?? null) &&
  a.title === b.title &&
  (a.description ?? null) === (b.description ?? null) &&
  (a.acceptanceCriteria ?? null) === (b.acceptanceCriteria ?? null);

/** Locks the project row so concurrent edits to one project's draft are serialised. */
async function lockProject(db: Db, tenantId: string, projectId: string) {
  const r = await db.query("select id from project where id = $1 and tenant_id = $2 for update", [projectId, tenantId]);
  if (r.rowCount === 0) throw new Error("Project not found");
}

async function nextKey(db: Db, projectId: string): Promise<string> {
  for (;;) {
    const n = (
      await db.query<{ key_counter: number }>(
        "update project set key_counter = key_counter + 1 where id = $1 returning key_counter",
        [projectId],
      )
    ).rows[0].key_counter;
    const key = `ITEM-${String(n).padStart(3, "0")}`;
    const taken = await db.query("select 1 from requirement where project_id = $1 and canonical_key = $2", [projectId, key]);
    if (taken.rowCount === 0) return key;
  }
}

type UpsertOutcome = "added" | "updated" | "unchanged" | "restored";

/**
 * Adds an item, or gives an existing item (same reference) a new revision.
 * Revisions are append-only: an edit never alters what an earlier baseline captured.
 */
async function upsertItem(
  db: Db,
  p: { tenantId: string; projectId: string; actorUserId: string; row: ScopeRow; position?: number },
): Promise<{ outcome: UpsertOutcome; key: string }> {
  const key = p.row.key ?? (await nextKey(db, p.projectId));
  const existing = (
    await db.query<Row & { status: string; current_revision_id: string }>(
      `select r.id, r.canonical_key, r.status, r.position, r.current_revision_id, v.rev_no, v.kind, v.section, v.title,
              v.description, v.acceptance_criteria
       from requirement r join requirement_revision v on v.id = r.current_revision_id
       where r.project_id = $1 and r.canonical_key = $2`,
      [p.projectId, key],
    )
  ).rows[0];

  if (!existing) {
    const position =
      p.position ??
      (await db.query<{ n: number }>("select coalesce(max(position), 0) + 1 as n from requirement where project_id = $1", [p.projectId]))
        .rows[0].n;
    const req = (
      await db.query<{ id: string }>(
        "insert into requirement (tenant_id, project_id, canonical_key, position) values ($1, $2, $3, $4) returning id",
        [p.tenantId, p.projectId, key, position],
      )
    ).rows[0];
    const rev = await insertRevision(db, p.tenantId, req.id, 1, p.row, p.actorUserId);
    await db.query("update requirement set current_revision_id = $2 where id = $1", [req.id, rev]);
    return { outcome: "added", key };
  }

  const current = toItem(existing);
  const restoring = existing.status === "removed";
  if (!restoring && sameContent(current, p.row)) return { outcome: "unchanged", key };
  let revId = existing.current_revision_id;
  if (!sameContent(current, p.row)) {
    revId = await insertRevision(db, p.tenantId, existing.id, current.revNo + 1, p.row, p.actorUserId);
  }
  await db.query("update requirement set current_revision_id = $2, status = 'active' where id = $1", [existing.id, revId]);
  return { outcome: restoring ? "restored" : "updated", key };
}

async function insertRevision(db: Db, tenantId: string, requirementId: string, revNo: number, c: Content, author: string) {
  return (
    await db.query<{ id: string }>(
      `insert into requirement_revision
         (tenant_id, requirement_id, rev_no, kind, section, title, description, acceptance_criteria, author_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [tenantId, requirementId, revNo, c.kind, c.section, c.title, c.description, c.acceptanceCriteria, author],
    )
  ).rows[0].id;
}

export type ImportSummary = { added: number; updated: number; unchanged: number; restored: number };

/** Imports parsed rows into the draft. Rows with a known reference update that item. */
export async function importRows(p: {
  tenantId: string;
  projectId: string;
  actorUserId: string;
  rows: ScopeRow[];
  fileName: string;
}): Promise<ImportSummary> {
  return tx(async (db) => {
    await lockProject(db, p.tenantId, p.projectId);
    const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0, restored: 0 };
    const start = (
      await db.query<{ n: number }>("select coalesce(max(position), 0) as n from requirement where project_id = $1", [p.projectId])
    ).rows[0].n;
    let i = 0;
    for (const row of p.rows) {
      i += 1;
      const { outcome } = await upsertItem(db, { ...p, row, position: start + i });
      summary[outcome] += 1;
    }
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "scope.imported",
      target: `project:${p.projectId}`,
      detail: { fileName: p.fileName.slice(0, 200), rows: p.rows.length, ...summary },
    });
    return summary;
  });
}

export async function saveItem(p: {
  tenantId: string;
  projectId: string;
  actorUserId: string;
  itemId?: string;
  input: unknown;
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const parsed = itemInput.safeParse(p.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  return tx(async (db) => {
    await lockProject(db, p.tenantId, p.projectId);
    let key = v.key;
    if (p.itemId) {
      if (!isUuid(p.itemId)) return { ok: false, error: "Item not found" } as const;
      // Editing keeps the item's reference; it can't be renamed onto another item.
      const item = (
        await db.query<{ canonical_key: string }>(
          "select canonical_key from requirement where id = $1 and project_id = $2 and tenant_id = $3",
          [p.itemId, p.projectId, p.tenantId],
        )
      ).rows[0];
      if (!item) return { ok: false, error: "Item not found" } as const;
      key = item.canonical_key;
    } else if (key) {
      const taken = await db.query(
        "select 1 from requirement where project_id = $1 and canonical_key = $2 and status = 'active'",
        [p.projectId, key],
      );
      if (taken.rowCount) return { ok: false, error: `Reference ${key} is already in use` } as const;
    }
    const result = await upsertItem(db, {
      tenantId: p.tenantId,
      projectId: p.projectId,
      actorUserId: p.actorUserId,
      row: { ...v, key },
    });
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: p.itemId ? "scope.item_edited" : "scope.item_added",
      target: `project:${p.projectId}`,
      detail: { key: result.key, outcome: result.outcome },
    });
    return { ok: true, key: result.key } as const;
  });
}

export async function removeItem(p: { tenantId: string; projectId: string; actorUserId: string; itemId: string }) {
  if (!isUuid(p.itemId)) return;
  await tx(async (db) => {
    await lockProject(db, p.tenantId, p.projectId);
    const r = await db.query<{ canonical_key: string }>(
      `update requirement set status = 'removed'
       where id = $1 and project_id = $2 and tenant_id = $3 and status = 'active' returning canonical_key`,
      [p.itemId, p.projectId, p.tenantId],
    );
    if (r.rowCount) {
      await recordAudit(db, {
        tenantId: p.tenantId,
        actorUserId: p.actorUserId,
        action: "scope.item_removed",
        target: `project:${p.projectId}`,
        detail: { key: r.rows[0].canonical_key },
      });
    }
  });
}

export async function getDraftItem(tenantId: string, projectId: string, itemId: string): Promise<DraftItem | null> {
  if (!isUuid(itemId)) return null;
  const rows = await query<Row>(`${DRAFT_SELECT} and r.id = $3`, [projectId, tenantId, itemId]);
  return rows[0] ? toItem(rows[0]) : null;
}
