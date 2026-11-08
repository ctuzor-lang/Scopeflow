import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { requestSignInCode } from "../src/lib/auth";
import { createSandbox, demoGuide, demoSession } from "../src/lib/demo";
import { decideChange } from "../src/lib/decisions";
import { one, query } from "../src/lib/db";
import { resolveTenant, sandboxFromCookie, signDemoCookie } from "../src/lib/tenant";
import { makeTenant, sentMail } from "./helpers";

describe("public demo sandboxes", () => {
  it("builds a private sample workspace with changes at each stage, and sends no email", async () => {
    const before = sentMail.length;
    const { tenant, projectId } = await createSandbox("203.0.113.10");
    expect(tenant.sandbox).toBe(true);
    const crs = await query<{ number: number; status: string }>("select number, status from change_request where project_id = $1 order by number", [projectId]);
    expect(crs).toEqual([
      { number: 1, status: "awaiting_client" },
      { number: 2, status: "submitted" },
      { number: 3, status: "rejected" },
    ]);
    expect(sentMail.length).toBe(before); // invitation, "decision needed" and decline notices all suppressed
    const users = await query<{ email: string }>(
      "select u.email from app_user u join membership m on m.user_id = u.id where m.tenant_id = $1 union select u.email from app_user u join project_access a on a.user_id = u.id where a.tenant_id = $1",
      [tenant.id],
    );
    expect(users.every((u) => u.email.endsWith("@sandbox.invalid"))).toBe(true);
  });

  it("guides the visitor through the loop in order", async () => {
    const { tenant, projectId } = await createSandbox("203.0.113.11");
    expect(await demoGuide(tenant.id)).toMatchObject({ n: 1, role: "client" });
    const client = await demoSession(tenant, "client");
    expect(client.token).toBeTruthy();
    const approver = await one<{ user_id: string }>("select user_id from project_access where tenant_id = $1", [tenant.id]);
    const rev = await one<{ id: string }>(
      "select r.id from impact_revision r join change_request c on c.id = r.change_request_id where c.project_id = $1 and c.number = 1",
      [projectId],
    );
    const r = await decideChange({ tenant, projectId, number: 1, userId: approver!.user_id, revisionId: rev!.id, outcome: "approved", authorityConfirmed: true, comment: null, ip: null, userAgent: null });
    expect(r.ok).toBe(true);
    expect(await demoGuide(tenant.id)).toMatchObject({ n: 2, role: "agency" });
  });

  it("only a correctly signed cookie opens a sandbox, and sandboxes never answer to a web address", async () => {
    const { tenant } = await createSandbox("203.0.113.12");
    expect((await sandboxFromCookie(signDemoCookie(tenant.id)))?.id).toBe(tenant.id);
    expect(await sandboxFromCookie(`${tenant.id}.${"0".repeat(64)}`)).toBeNull();
    expect(await sandboxFromCookie("garbage")).toBeNull();
    // A real tenant's id with a forged signature doesn't work, and a real tenant is never a sandbox.
    const real = await makeTenant();
    expect(await sandboxFromCookie(signDemoCookie(real.tenantId))).toBeNull();
    // Sign-in codes are never emailed from a sandbox.
    const before = sentMail.length;
    const email = (await one<{ email: string }>("select u.email from app_user u join membership m on m.user_id = u.id where m.tenant_id = $1", [tenant.id]))!.email;
    await requestSignInCode(tenant, email, null);
    expect(sentMail.length).toBe(before);
    expect(await resolveTenant(`${tenant.slug}.example.test`)).toBeNull();
  });

  it("limits how many sandboxes one address can create per hour", async () => {
    for (let i = 0; i < 5; i++) await createSandbox("203.0.113.99");
    await expect(createSandbox("203.0.113.99")).rejects.toThrow();
  });

  it("the clean-up removes expired sandboxes completely and leaves real workspaces alone", async () => {
    const real = await makeTenant();
    const { tenant } = await createSandbox("203.0.113.13");
    await query("update tenant set sandbox_expires_at = now() - interval '2 hours' where id = $1", [tenant.id]);
    const url = new URL(process.env.DATABASE_URL!);
    execFileSync("bash", ["deploy/demo-cleanup.sh"], {
      env: { ...process.env, SCOPEFLOW_PSQL: `psql -h ${url.searchParams.get("host")} -U ${url.username}`, SCOPEFLOW_DB: url.pathname.slice(1) },
    });
    expect(await one("select id from tenant where id = $1", [tenant.id])).toBeNull();
    for (const t of ["project", "change_request", "audit_event", "baseline", "membership", "session"]) {
      expect(await one(`select 1 from ${t} where tenant_id = $1 limit 1`, [tenant.id])).toBeNull();
    }
    expect(await one("select id from tenant where id = $1", [real.tenantId])).not.toBeNull();
    expect(await one("select 1 from audit_event where tenant_id = $1 limit 1", [real.tenantId])).not.toBeNull();
  });
});

describe("demo sandboxes never store real addresses", () => {
  it("rewrites a client invitation to a throwaway address", async () => {
    const { inviteClient } = await import("../src/lib/clients");
    const { tenant, projectId, agencyUserId } = await createSandbox("203.0.113.20");
    const r = await inviteClient({ tenant, projectId, actorUserId: agencyUserId, input: { email: "ceo@realcompany.example", name: "Real Person", role: "viewer" } });
    expect(r.ok).toBe(true);
    expect(await one("select 1 from app_user where email = 'ceo@realcompany.example'")).toBeNull();
    expect(await one("select 1 from app_user where email like 'ceo-%@sandbox.invalid'")).not.toBeNull();
  });
});
