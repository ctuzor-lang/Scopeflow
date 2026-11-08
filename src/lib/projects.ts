import { z } from "zod";
import { recordAudit } from "./audit";
import type { Role } from "./auth";
import { one, query, tx } from "./db";

export const canManageProjects = (role: Role) => role === "admin" || role === "pm";
export const canEditScope = (_role: Role) => true;
export const canPublish = (role: Role) => role === "admin" || role === "pm";

export type Project = {
  id: string;
  name: string;
  reference: string | null;
  currency: string;
  clientName: string;
  createdAt: Date;
};

type Row = { id: string; name: string; reference: string | null; currency: string; client_name: string; created_at: Date };

const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  reference: r.reference,
  currency: r.currency,
  clientName: r.client_name,
  createdAt: r.created_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const newProjectInput = z.object({
  name: z.string().trim().min(1, "Enter a project name").max(160),
  clientName: z.string().trim().min(1, "Enter the client's name").max(160),
  reference: z
    .string()
    .trim()
    .max(60)
    .transform((v) => v || null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. GBP"),
});

export async function createProject(params: {
  tenantId: string;
  actorUserId: string;
  input: unknown;
}): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const parsed = newProjectInput.safeParse(params.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cap = await one<{ sandbox: boolean; n: string }>(
    `select t.sandbox_expires_at is not null as sandbox, (select count(*) from project p where p.tenant_id = t.id) as n
     from tenant t where t.id = $1`,
    [params.tenantId],
  );
  if (cap?.sandbox && Number(cap.n) >= 5) return { ok: false, error: "The demo allows up to 5 projects. Start the demo again for a fresh workspace." };
  const projectId = await tx(async (db) => {
    const client = (
      await db.query<{ id: string }>(
        `insert into client_organisation (tenant_id, name) values ($1, $2)
         on conflict (tenant_id, name) do update set name = excluded.name returning id`,
        [params.tenantId, v.clientName],
      )
    ).rows[0];
    const project = (
      await db.query<{ id: string }>(
        `insert into project (tenant_id, client_org_id, name, reference, currency, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [params.tenantId, client.id, v.name, v.reference, v.currency, params.actorUserId],
      )
    ).rows[0];
    await recordAudit(db, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "project.created",
      target: `project:${project.id}`,
      detail: { name: v.name, client: v.clientName, reference: v.reference, currency: v.currency },
    });
    return project.id;
  });
  return { ok: true, projectId };
}

export type Attention = { toAssess: number; awaitingClient: number; toIncorporate: number };

const ATTENTION_SQL = `
  (select count(*) from change_request c where c.project_id = p.id and c.status in ('submitted', 'assessing')) as to_assess,
  (select count(*) from change_request c where c.project_id = p.id and c.status = 'awaiting_client') as awaiting_client,
  (select count(*) from change_request c where c.project_id = p.id and c.status = 'approved') as to_incorporate`;

type AttentionRow = { to_assess: string; awaiting_client: string; to_incorporate: string };
const toAttention = (r: AttentionRow): Attention => ({
  toAssess: Number(r.to_assess),
  awaitingClient: Number(r.awaiting_client),
  toIncorporate: Number(r.to_incorporate),
});

export async function listProjects(
  tenantId: string,
): Promise<(Project & { latestVersion: number | null; itemCount: number; attention: Attention })[]> {
  const rows = await query<Row & AttentionRow & { latest_version: number | null; item_count: string }>(
    `select p.id, p.name, p.reference, p.currency, c.name as client_name, p.created_at,
            (select max(version_number) from baseline b where b.project_id = p.id) as latest_version,
            (select count(*) from requirement r where r.project_id = p.id and r.status = 'active') as item_count,
            ${ATTENTION_SQL}
     from project p join client_organisation c on c.id = p.client_org_id
     where p.tenant_id = $1 and p.status = 'active'
     order by p.created_at desc`,
    [tenantId],
  );
  return rows.map((r) => ({ ...toProject(r), latestVersion: r.latest_version, itemCount: Number(r.item_count), attention: toAttention(r) }));
}

export type ProjectProgress = Attention & { draftItems: number; versions: number; approvers: number; clientPeople: number; changes: number };

/** Where a project is in its journey, for the setup checklist and "next step" hints. */
export async function projectProgress(tenantId: string, projectId: string): Promise<ProjectProgress> {
  const r = await one<AttentionRow & { draft_items: string; versions: string; approvers: string; client_people: string; changes: string }>(
    `select ${ATTENTION_SQL},
            (select count(*) from requirement r where r.project_id = p.id and r.status = 'active') as draft_items,
            (select count(*) from baseline b where b.project_id = p.id) as versions,
            (select count(*) from project_access a where a.project_id = p.id and a.status = 'active' and a.role = 'approver') as approvers,
            (select count(*) from project_access a where a.project_id = p.id and a.status = 'active') as client_people,
            (select count(*) from change_request c where c.project_id = p.id) as changes
     from project p where p.id = $1 and p.tenant_id = $2`,
    [projectId, tenantId],
  );
  if (!r) return { toAssess: 0, awaitingClient: 0, toIncorporate: 0, draftItems: 0, versions: 0, approvers: 0, clientPeople: 0, changes: 0 };
  return {
    ...toAttention(r),
    draftItems: Number(r.draft_items),
    versions: Number(r.versions),
    approvers: Number(r.approvers),
    clientPeople: Number(r.client_people),
    changes: Number(r.changes),
  };
}

/** Fetches a project only if it belongs to this tenant. Anything else looks like "not found". */
export async function getProject(tenantId: string, projectId: string): Promise<Project | null> {
  if (!UUID.test(projectId)) return null;
  const row = await one<Row>(
    `select p.id, p.name, p.reference, p.currency, c.name as client_name, p.created_at
     from project p join client_organisation c on c.id = p.client_org_id
     where p.id = $1 and p.tenant_id = $2 and p.status = 'active'`,
    [projectId, tenantId],
  );
  return row ? toProject(row) : null;
}

export const isUuid = (v: string) => UUID.test(v);
