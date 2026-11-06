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

export async function listProjects(tenantId: string): Promise<(Project & { latestVersion: number | null; itemCount: number })[]> {
  const rows = await query<Row & { latest_version: number | null; item_count: string }>(
    `select p.id, p.name, p.reference, p.currency, c.name as client_name, p.created_at,
            (select max(version_number) from baseline b where b.project_id = p.id) as latest_version,
            (select count(*) from requirement r where r.project_id = p.id and r.status = 'active') as item_count
     from project p join client_organisation c on c.id = p.client_org_id
     where p.tenant_id = $1 and p.status = 'active'
     order by p.created_at desc`,
    [tenantId],
  );
  return rows.map((r) => ({ ...toProject(r), latestVersion: r.latest_version, itemCount: Number(r.item_count) }));
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
