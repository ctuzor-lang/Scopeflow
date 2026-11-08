import { recordAudit } from "./audit";
import { config } from "./config";
import { hmac, randomToken, safeEqualHex, sha256, sixDigitCode } from "./crypto";
import { one, query, tx } from "./db";
import { mailer, mailError } from "./mailer";
import type { Tenant } from "./tenant";

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_WINDOW = 5;
export const CODE_WINDOW_MINUTES = 15;
export const SESSION_DAYS = 7;
export const SESSION_COOKIE = "sf_session";

export type Role = "admin" | "pm" | "contributor";
/**
 * Agency people are members of the tenant. Client people only have access to
 * specific projects; they never see the agency workspace.
 */
export type CurrentUser =
  | { kind: "agency"; userId: string; email: string; displayName: string | null; role: Role; sessionId: string }
  | { kind: "client"; userId: string; email: string; displayName: string | null; role: "client"; sessionId: string };

/** A user may sign in to a tenant if they're an active member, or have active access to one of its live projects. */
const CAN_SIGN_IN = `
  (exists (select 1 from membership m where m.user_id = u.id and m.tenant_id = $1 and m.status = 'active')
   or exists (select 1 from project_access a join project p on p.id = a.project_id
              where a.user_id = u.id and a.tenant_id = $1 and a.status = 'active' and p.status = 'active'))`;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

// The code is bound to its tenant and email, so a code issued on one tenant's address is useless on another.
const codeHash = (tenantId: string, email: string, code: string) =>
  hmac(config().SECRET_KEY, `${tenantId}:${email}:${code}`);

/**
 * Emails a sign-in code if the address belongs to an active member of this tenant.
 * Always behaves the same from the outside, so it can't be used to discover who is a member.
 */
export async function requestSignInCode(tenant: Tenant, rawEmail: string, ip: string | null): Promise<void> {
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return;

  const member = await one<{ user_id: string }>(
    `select u.id as user_id from app_user u where u.email = $2 and ${CAN_SIGN_IN}`,
    [tenant.id, email],
  );
  if (!member) return;

  const recent = await one<{ n: string }>(
    `select count(*) as n from login_code
     where tenant_id = $1 and email = $2 and created_at > now() - make_interval(mins => $3)`,
    [tenant.id, email, CODE_WINDOW_MINUTES],
  );
  if (Number(recent?.n ?? 0) >= MAX_CODES_PER_WINDOW) return;

  const code = sixDigitCode();
  await tx(async (db) => {
    // A new code replaces any outstanding one.
    await db.query(
      "update login_code set consumed_at = now() where tenant_id = $1 and email = $2 and consumed_at is null",
      [tenant.id, email],
    );
    await db.query(
      `insert into login_code (tenant_id, email, code_hash, expires_at, ip)
       values ($1, $2, $3, now() + make_interval(mins => $4), $5)`,
      [tenant.id, email, codeHash(tenant.id, email, code), CODE_TTL_MINUTES, ip],
    );
    await recordAudit(db, {
      tenantId: tenant.id,
      actorUserId: member.user_id,
      action: "auth.code_requested",
      target: `user:${member.user_id}`,
      ip,
    });
  });

  try {
    await mailer().send({
      to: email,
      fromName: tenant.branding.displayName,
      subject: `Your sign-in code for ${tenant.branding.displayName}`,
      text: [
        `Your sign-in code is ${code}.`,
        "",
        `It expires in ${CODE_TTL_MINUTES} minutes and works once.`,
        "If you didn't ask for this code, you can ignore this email.",
      ].join("\n"),
    });
  } catch (err) {
    // Same response either way so the page doesn't reveal who is a member; the operator sees this in the log.
    console.error(`[mail] sign-in code NOT sent (tenant ${tenant.slug}): ${mailError(err)}`);
  }
}

export type VerifyResult = { ok: true; sessionToken: string; expiresAt: Date } | { ok: false };

/** Checks a code and, if it's right, opens a session bound to this tenant. */
export async function verifySignInCode(
  tenant: Tenant,
  rawEmail: string,
  rawCode: string,
  ip: string | null,
): Promise<VerifyResult> {
  const email = normaliseEmail(rawEmail);
  const code = rawCode.replace(/\s/g, "");
  if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) return { ok: false };

  return tx(async (db) => {
    const row = (
      await db.query<{ id: string; code_hash: string; attempts: number }>(
        `select id, code_hash, attempts from login_code
         where tenant_id = $1 and email = $2 and consumed_at is null and expires_at > now()
         order by created_at desc limit 1 for update`,
        [tenant.id, email],
      )
    ).rows[0];
    if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false } as const;

    if (!safeEqualHex(row.code_hash, codeHash(tenant.id, email, code))) {
      await db.query("update login_code set attempts = attempts + 1 where id = $1", [row.id]);
      return { ok: false } as const;
    }

    await db.query("update login_code set consumed_at = now() where id = $1", [row.id]);

    const member = (
      await db.query<{ user_id: string }>(`select u.id as user_id from app_user u where u.email = $2 and ${CAN_SIGN_IN}`, [
        tenant.id,
        email,
      ])
    ).rows[0];
    if (!member) return { ok: false } as const;

    const token = randomToken(32);
    const session = (
      await db.query<{ id: string; expires_at: Date }>(
        `insert into session (tenant_id, user_id, token_hash, expires_at)
         values ($1, $2, $3, now() + make_interval(days => $4)) returning id, expires_at`,
        [tenant.id, member.user_id, sha256(token), SESSION_DAYS],
      )
    ).rows[0];

    await recordAudit(db, {
      tenantId: tenant.id,
      actorUserId: member.user_id,
      action: "auth.signed_in",
      target: `session:${session.id}`,
      ip,
    });
    return { ok: true, sessionToken: token, expiresAt: new Date(session.expires_at) } as const;
  });
}

/** The signed-in user for this tenant, or null. A session from another tenant never matches. */
export async function userForSession(tenant: Tenant, token: string | undefined | null): Promise<CurrentUser | null> {
  if (!token) return null;
  const row = await one<{ session_id: string; user_id: string; email: string; display_name: string | null; role: Role | null }>(
    `select s.id as session_id, u.id as user_id, u.email, u.display_name, m.role
     from session s
     join app_user u on u.id = s.user_id
     left join membership m on m.user_id = s.user_id and m.tenant_id = s.tenant_id and m.status = 'active'
     where s.token_hash = $2 and s.tenant_id = $1 and s.revoked_at is null and s.expires_at > now()
       and ${CAN_SIGN_IN}`,
    [tenant.id, sha256(token)],
  );
  if (!row) return null;
  await query("update session set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '5 minutes'", [
    row.session_id,
  ]);
  const base = { userId: row.user_id, email: row.email, displayName: row.display_name, sessionId: row.session_id };
  return row.role ? { kind: "agency", role: row.role, ...base } : { kind: "client", role: "client", ...base };
}

export async function signOut(tenant: Tenant, user: CurrentUser, ip: string | null): Promise<void> {
  await tx(async (db) => {
    await db.query("update session set revoked_at = now() where id = $1 and tenant_id = $2", [
      user.sessionId,
      tenant.id,
    ]);
    await recordAudit(db, {
      tenantId: tenant.id,
      actorUserId: user.userId,
      action: "auth.signed_out",
      target: `session:${user.sessionId}`,
      ip,
    });
  });
}
