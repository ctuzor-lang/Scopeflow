import { canonicalJson, recordAudit } from "./audit";
import { sha256 } from "./crypto";
import { one, query, tx } from "./db";
import type { Kind } from "./importer";

/** What a baseline records for each item: exactly what was agreed, nothing derived. */
export type ItemPayload = {
  key: string;
  kind: Kind;
  section: string | null;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
};

export type Baseline = {
  id: string;
  version: number;
  status: string;
  digest: string;
  itemCount: number;
  publishedAt: Date;
  publishedBy: string | null;
};

type BaselineRow = {
  id: string;
  version_number: number;
  status: string;
  content_digest: string;
  item_count: number;
  published_at: Date;
  published_by_email: string | null;
};

const toBaseline = (r: BaselineRow): Baseline => ({
  id: r.id,
  version: r.version_number,
  status: r.status,
  digest: r.content_digest,
  itemCount: r.item_count,
  publishedAt: r.published_at,
  publishedBy: r.published_by_email,
});

/** Deterministic digest of a baseline's content: same items, same digest, whatever order they were stored in. */
export function baselineDigest(projectId: string, version: number, items: ItemPayload[]): string {
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `sha256:${sha256(canonicalJson({ projectId, version, items: sorted }))}`;
}

const BASELINE_SELECT = `
  select b.id, b.version_number, b.status, b.content_digest, b.item_count, b.published_at, coalesce(u.display_name, u.email) as published_by_email
  from baseline b left join app_user u on u.id = b.published_by
  where b.project_id = $1 and b.tenant_id = $2`;

export async function listBaselines(tenantId: string, projectId: string): Promise<Baseline[]> {
  const rows = await query<BaselineRow>(`${BASELINE_SELECT} order by b.version_number desc`, [projectId, tenantId]);
  return rows.map(toBaseline);
}

export async function getBaseline(tenantId: string, projectId: string, version: number): Promise<Baseline | null> {
  if (!Number.isInteger(version) || version < 1) return null;
  const row = await one<BaselineRow>(`${BASELINE_SELECT} and b.version_number = $3`, [projectId, tenantId, version]);
  return row ? toBaseline(row) : null;
}

export async function baselineItems(baselineId: string): Promise<ItemPayload[]> {
  const rows = await query<{ payload: ItemPayload }>(
    "select payload from baseline_item where baseline_id = $1 order by position",
    [baselineId],
  );
  return rows.map((r) => r.payload);
}

export type Diff = { added: ItemPayload[]; removed: ItemPayload[]; changed: { before: ItemPayload; after: ItemPayload }[] };

export function diffItems(before: ItemPayload[], after: ItemPayload[]): Diff {
  const b = new Map(before.map((i) => [i.key, i]));
  const a = new Map(after.map((i) => [i.key, i]));
  const added = after.filter((i) => !b.has(i.key));
  const removed = before.filter((i) => !a.has(i.key));
  const changed = after
    .filter((i) => b.has(i.key) && canonicalJson(b.get(i.key)) !== canonicalJson(i))
    .map((i) => ({ before: b.get(i.key)!, after: i }));
  return { added, removed, changed };
}

export const diffSize = (d: Diff) => d.added.length + d.removed.length + d.changed.length;

/** The draft as it would be published, with each item's current revision id. */
async function draftPayloads(tenantId: string, projectId: string) {
  return query<ItemPayload & { revisionId: string; position: number }>(
    `select r.canonical_key as key, v.kind, v.section, v.title, v.description,
            v.acceptance_criteria as "acceptanceCriteria", v.id as "revisionId", r.position
     from requirement r join requirement_revision v on v.id = r.current_revision_id
     where r.project_id = $1 and r.tenant_id = $2 and r.status = 'active'
     order by r.position, r.canonical_key`,
    [projectId, tenantId],
  );
}

const stripMeta = ({ key, kind, section, title, description, acceptanceCriteria }: ItemPayload): ItemPayload => ({
  key,
  kind,
  section,
  title,
  description,
  acceptanceCriteria,
});

/** What has changed in the draft since the latest published baseline. */
export async function draftChanges(tenantId: string, projectId: string) {
  const [draft, versions] = await Promise.all([draftPayloads(tenantId, projectId), listBaselines(tenantId, projectId)]);
  const latest = versions[0] ?? null;
  const published = latest ? await baselineItems(latest.id) : [];
  return { latest, diff: diffItems(published, draft.map(stripMeta)), draftCount: draft.length };
}

export type PublishResult = { ok: true; version: number; digest: string } | { ok: false; error: string };

/** Freezes the current draft as the next numbered baseline. */
export async function publishBaseline(p: {
  tenantId: string;
  projectId: string;
  actorUserId: string;
  /** Approved change requests (by number) that this version puts into effect. */
  includesChanges?: number[];
}): Promise<PublishResult> {
  return tx(async (db) => {
    const locked = await db.query("select id from project where id = $1 and tenant_id = $2 for update", [p.projectId, p.tenantId]);
    if (locked.rowCount === 0) return { ok: false, error: "Project not found" } as const;

    const draft = (
      await db.query<ItemPayload & { revisionId: string }>(
        `select r.canonical_key as key, v.kind, v.section, v.title, v.description,
                v.acceptance_criteria as "acceptanceCriteria", v.id as "revisionId"
         from requirement r join requirement_revision v on v.id = r.current_revision_id
         where r.project_id = $1 and r.tenant_id = $2 and r.status = 'active'
         order by r.position, r.canonical_key`,
        [p.projectId, p.tenantId],
      )
    ).rows;
    if (draft.length === 0) return { ok: false, error: "Add at least one item before publishing." } as const;

    const latest = (
      await db.query<{ id: string; version_number: number }>(
        "select id, version_number from baseline where project_id = $1 order by version_number desc limit 1",
        [p.projectId],
      )
    ).rows[0];
    if (latest) {
      const prev = (
        await db.query<{ payload: ItemPayload }>("select payload from baseline_item where baseline_id = $1", [latest.id])
      ).rows.map((r) => r.payload);
      // A version may repeat the scope exactly only to record approved changes that don't alter any item (e.g. schedule only).
      if (diffSize(diffItems(prev, draft.map(stripMeta))) === 0 && !(p.includesChanges ?? []).length) {
        return { ok: false, error: `Nothing has changed since version ${latest.version_number}.` } as const;
      }
    }

    const wanted = [...new Set(p.includesChanges ?? [])];
    const included = wanted.length
      ? (
          await db.query<{ id: string; number: number; status: string }>(
            "select id, number, status from change_request where project_id = $1 and tenant_id = $2 and number = any($3) for update",
            [p.projectId, p.tenantId, wanted],
          )
        ).rows
      : [];
    const notApproved = wanted.filter((n) => included.find((c) => c.number === n)?.status !== "approved");
    if (notApproved.length) {
      return { ok: false, error: `Only approved changes can be included (check ${notApproved.map((n) => `CR-${String(n).padStart(3, "0")}`).join(", ")}).` } as const;
    }

    const version = (latest?.version_number ?? 0) + 1;
    const payloads = draft.map(stripMeta);
    const digest = baselineDigest(p.projectId, version, payloads);
    const baseline = (
      await db.query<{ id: string }>(
        `insert into baseline (tenant_id, project_id, version_number, content_digest, item_count, published_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [p.tenantId, p.projectId, version, digest, draft.length, p.actorUserId],
      )
    ).rows[0];
    let position = 0;
    for (const item of draft) {
      position += 1;
      await db.query(
        `insert into baseline_item (baseline_id, requirement_revision_id, canonical_key, position, payload)
         values ($1, $2, $3, $4, $5)`,
        [baseline.id, item.revisionId, item.key, position, JSON.stringify(stripMeta(item))],
      );
    }
    for (const c of included) {
      await db.query("insert into baseline_change (baseline_id, change_request_id, tenant_id) values ($1, $2, $3)", [baseline.id, c.id, p.tenantId]);
      await db.query("update change_request set status = 'incorporated', updated_at = now() where id = $1", [c.id]);
    }
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "baseline.published",
      target: `project:${p.projectId}`,
      detail: { version, digest, items: draft.length, includesChanges: included.map((c) => c.number).sort((a, b) => a - b) },
    });
    return { ok: true, version, digest } as const;
  });
}

/** Recomputes a stored baseline's digest from its items. True if the content is exactly as published. */
export async function verifyBaseline(tenantId: string, projectId: string, version: number): Promise<boolean> {
  const b = await getBaseline(tenantId, projectId, version);
  if (!b) return false;
  return baselineDigest(projectId, version, await baselineItems(b.id)) === b.digest;
}

/** Approved changes not yet put into a scope version. */
export async function changesAwaitingIncorporation(tenantId: string, projectId: string) {
  return query<{ number: number; title: string }>(
    "select number, title from change_request where project_id = $1 and tenant_id = $2 and status = 'approved' order by number",
    [projectId, tenantId],
  );
}

/** The changes a version put into effect. */
export async function changesInBaseline(baselineId: string) {
  return query<{ number: number; title: string }>(
    `select c.number, c.title from baseline_change bc join change_request c on c.id = bc.change_request_id
     where bc.baseline_id = $1 order by c.number`,
    [baselineId],
  );
}

/** The version that put a change into effect, if any. */
export async function versionIncludingChange(changeRequestId: string): Promise<number | null> {
  const r = await one<{ version_number: number }>(
    "select b.version_number from baseline_change bc join baseline b on b.id = bc.baseline_id where bc.change_request_id = $1",
    [changeRequestId],
  );
  return r?.version_number ?? null;
}
