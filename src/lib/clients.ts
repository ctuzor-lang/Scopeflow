import { z } from "zod";
import { recordAudit } from "./audit";
import { normaliseEmail } from "./auth";
import { one, query, tx } from "./db";
import { mailerFor } from "./mailer";
import { isUuid } from "./projects";
import type { Tenant } from "./tenant";

export type ClientAccess = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: "approver" | "viewer";
  status: "active" | "revoked";
  invitedAt: Date;
};

/** The address clients use: the tenant's primary verified domain. */
export async function tenantBaseUrl(tenantId: string): Promise<string> {
  const row = await one<{ hostname: string }>(
    `select hostname from tenant_domain where tenant_id = $1 and verified_at is not null
     order by is_primary desc, created_at asc limit 1`,
    [tenantId],
  );
  return row ? `https://${row.hostname}` : "";
}

export async function listClientAccess(tenantId: string, projectId: string): Promise<ClientAccess[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    email: string;
    display_name: string | null;
    role: ClientAccess["role"];
    status: ClientAccess["status"];
    invited_at: Date;
  }>(
    `select a.id, a.user_id, u.email, u.display_name, a.role, a.status, a.invited_at
     from project_access a join app_user u on u.id = a.user_id
     where a.project_id = $1 and a.tenant_id = $2
     order by a.status, a.role, u.email`,
    [projectId, tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    name: r.display_name,
    role: r.role,
    status: r.status,
    invitedAt: r.invited_at,
  }));
}

export const inviteInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"),
  name: z.string().trim().min(1, "Enter the person's name").max(120),
  role: z.enum(["approver", "viewer"]),
});

/** Gives a client person access to one project and emails them how to sign in. */
export async function inviteClient(p: {
  tenant: Tenant;
  projectId: string;
  actorUserId: string;
  input: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inviteInput.safeParse(p.input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  // In a public demo sandbox, real addresses are never stored (they'd create real, shared user records):
  // the address becomes a throwaway one that the hourly clean-up removes with the sandbox.
  const email = p.tenant.sandbox
    ? `${normaliseEmail(v.email).split("@")[0].replace(/[^a-z0-9.-]/g, "").slice(0, 30) || "guest"}-${p.tenant.slug.slice(5)}@sandbox.invalid`
    : normaliseEmail(v.email);

  const result = await tx(async (db) => {
    const project = (
      await db.query<{ name: string }>("select name from project where id = $1 and tenant_id = $2 and status = 'active'", [
        p.projectId,
        p.tenant.id,
      ])
    ).rows[0];
    if (!project) return { ok: false, error: "Project not found" } as const;
    const isMember = await db.query(
      `select 1 from membership m join app_user u on u.id = m.user_id
       where m.tenant_id = $1 and u.email = $2 and m.status = 'active'`,
      [p.tenant.id, email],
    );
    if (isMember.rowCount) return { ok: false, error: "That person is already a member of your workspace." } as const;
    const user = (
      await db.query<{ id: string }>(
        `insert into app_user (email, display_name) values ($1, $2)
         on conflict (email) do update set display_name = coalesce(app_user.display_name, excluded.display_name)
         returning id`,
        [email, v.name],
      )
    ).rows[0];
    await db.query(
      `insert into project_access (tenant_id, project_id, user_id, role, invited_by)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, user_id) do update
         set role = excluded.role, status = 'active', revoked_at = null, invited_by = excluded.invited_by, invited_at = now()`,
      [p.tenant.id, p.projectId, user.id, v.role, p.actorUserId],
    );
    await recordAudit(db, {
      tenantId: p.tenant.id,
      actorUserId: p.actorUserId,
      action: "client.invited",
      target: `project:${p.projectId}`,
      detail: { email, role: v.role },
    });
    return { ok: true, projectName: project.name } as const;
  });
  if (!result.ok) return result;

  const base = await tenantBaseUrl(p.tenant.id);
  await mailerFor(p.tenant).send({
    to: email,
    fromName: p.tenant.branding.displayName,
    subject: `${p.tenant.branding.displayName} has given you access to ${result.projectName}`,
    text: [
      `Hello ${v.name},`,
      "",
      `${p.tenant.branding.displayName} uses ScopeFlow to agree project scope and changes with you.`,
      v.role === "approver"
        ? "You've been named as an approver: you can review proposed changes and approve or decline them."
        : "You can review proposed changes and ask questions about them.",
      "",
      `Sign in with this email address at ${base}/login. We'll email you a one-time code; there's no password.`,
    ].join("\n"),
  });
  return { ok: true };
}

export async function revokeClient(p: { tenantId: string; projectId: string; accessId: string; actorUserId: string }) {
  if (!isUuid(p.accessId)) return;
  await tx(async (db) => {
    const r = await db.query<{ user_id: string }>(
      `update project_access set status = 'revoked', revoked_at = now()
       where id = $1 and project_id = $2 and tenant_id = $3 and status = 'active' returning user_id`,
      [p.accessId, p.projectId, p.tenantId],
    );
    if (!r.rowCount) return;
    await recordAudit(db, {
      tenantId: p.tenantId,
      actorUserId: p.actorUserId,
      action: "client.revoked",
      target: `project:${p.projectId}`,
      detail: { userId: r.rows[0].user_id },
    });
  });
}

/** The client's role on a project, or null if they have no active access. */
export async function clientRole(tenantId: string, projectId: string, userId: string): Promise<"approver" | "viewer" | null> {
  if (!isUuid(projectId)) return null;
  const row = await one<{ role: "approver" | "viewer" }>(
    `select a.role from project_access a join project p on p.id = a.project_id
     where a.project_id = $1 and a.tenant_id = $2 and a.user_id = $3 and a.status = 'active' and p.status = 'active'`,
    [projectId, tenantId, userId],
  );
  return row?.role ?? null;
}

/** Projects a client can see, with changes that are waiting for them or already decided. */
export async function clientProjects(tenantId: string, userId: string) {
  return query<{
    project_id: string;
    project_name: string;
    role: "approver" | "viewer";
    number: number | null;
    title: string | null;
    status: string | null;
    updated_at: Date | null;
  }>(
    `select p.id as project_id, p.name as project_name, a.role, c.number, c.title, c.status, c.updated_at
     from project_access a
     join project p on p.id = a.project_id and p.status = 'active'
     left join change_request c on c.project_id = p.id
       and c.status in ('awaiting_client', 'approved', 'rejected', 'incorporated')
     where a.tenant_id = $1 and a.user_id = $2 and a.status = 'active'
     order by p.name, (c.status = 'awaiting_client') desc nulls last, c.number desc`,
    [tenantId, userId],
  );
}
