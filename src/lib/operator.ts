import { recordAudit } from "./audit";
import { randomToken } from "./crypto";
import { tx } from "./db";
import { normaliseEmail } from "./auth";
import { normaliseHost } from "./tenant";

export type NewTenant = {
  slug: string;
  name: string;
  plan?: "pilot" | "agency" | "white_label";
  accentColour?: string;
  hostname?: string;
  // The platform operator vouches for the domain (e.g. Chayse's own). Customer domains
  // are verified by DNS before activation; that flow arrives with the operator console.
  hostnameVerified?: boolean;
  adminEmail: string;
  adminName?: string;
};

/** Platform-operator action: creates a tenant, its branding, an optional domain and its first admin. */
export async function createTenant(input: NewTenant): Promise<{ tenantId: string; userId: string }> {
  const email = normaliseEmail(input.adminEmail);
  const hostname = input.hostname ? normaliseHost(input.hostname) : null;
  if (input.hostname && !hostname) throw new Error(`Invalid hostname: ${input.hostname}`);

  return tx(async (db) => {
    const tenant = (
      await db.query<{ id: string }>("insert into tenant (slug, name, plan) values ($1, $2, $3) returning id", [
        input.slug,
        input.name,
        input.plan ?? "pilot",
      ])
    ).rows[0];
    await db.query("insert into tenant_branding (tenant_id, display_name, accent_colour) values ($1, $2, $3)", [
      tenant.id,
      input.name,
      input.accentColour ?? "#1b68ea",
    ]);
    if (hostname) {
      await db.query(
        `insert into tenant_domain (tenant_id, hostname, verification_token, verified_at, is_primary)
         values ($1, $2, $3, $4, true)`,
        [tenant.id, hostname, randomToken(18), input.hostnameVerified ? new Date() : null],
      );
    }
    const user = (
      await db.query<{ id: string }>(
        `insert into app_user (email, display_name) values ($1, $2)
         on conflict (email) do update set email = excluded.email returning id`,
        [email, input.adminName ?? null],
      )
    ).rows[0];
    await db.query("insert into membership (user_id, tenant_id, role) values ($1, $2, 'admin')", [user.id, tenant.id]);
    await recordAudit(db, {
      tenantId: tenant.id,
      actorUserId: null,
      action: "tenant.created",
      target: `tenant:${tenant.id}`,
      detail: { slug: input.slug, plan: input.plan ?? "pilot", hostname, adminEmail: email, by: "platform-operator" },
    });
    return { tenantId: tenant.id, userId: user.id };
  });
}

/** Adds a member to a tenant (agency staff). */
export async function addMember(params: {
  tenantId: string;
  email: string;
  role: "admin" | "pm" | "contributor";
  actorUserId: string | null;
}): Promise<string> {
  const email = normaliseEmail(params.email);
  return tx(async (db) => {
    const user = (
      await db.query<{ id: string }>(
        `insert into app_user (email) values ($1) on conflict (email) do update set email = excluded.email returning id`,
        [email],
      )
    ).rows[0];
    await db.query(
      `insert into membership (user_id, tenant_id, role) values ($1, $2, $3)
       on conflict (user_id, tenant_id) do update set role = excluded.role, status = 'active'`,
      [user.id, params.tenantId, params.role],
    );
    await recordAudit(db, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "member.added",
      target: `user:${user.id}`,
      detail: { email, role: params.role },
    });
    return user.id;
  });
}
