import { describe, expect, it } from "vitest";
import {
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  requestSignInCode,
  signOut,
  userForSession,
  verifySignInCode,
} from "../src/lib/auth";
import { query } from "../src/lib/db";
import { addMember } from "../src/lib/operator";
import { lastCodeFor, makeTenant, sentMail } from "./helpers";

describe("email-code sign-in", () => {
  it("emails a code to a member and signs them in", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail.toUpperCase(), "127.0.0.1");
    const mail = sentMail.at(-1)!;
    expect(mail.to).toBe(adminEmail);
    expect(mail.subject).toContain(tenant.branding.displayName);

    const result = await verifySignInCode(tenant, adminEmail, lastCodeFor(adminEmail), null);
    expect(result.ok).toBe(true);
    const user = await userForSession(tenant, result.ok ? result.sessionToken : null);
    expect(user?.email).toBe(adminEmail);
    expect(user?.role).toBe("admin");
  });

  it("sends nothing to an address that isn't a member", async () => {
    const { tenant } = await makeTenant();
    const before = sentMail.length;
    await requestSignInCode(tenant, "stranger@example.test", null);
    expect(sentMail.length).toBe(before);
  });

  it("rejects a wrong code and locks the code after too many attempts", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const good = lastCodeFor(adminEmail);
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect((await verifySignInCode(tenant, adminEmail, bad, null)).ok).toBe(false);
    }
    // Even the right code no longer works once the attempts are used up.
    expect((await verifySignInCode(tenant, adminEmail, good, null)).ok).toBe(false);
  });

  it("rejects an expired code", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    await query("update login_code set expires_at = now() - interval '1 second' where email = $1", [adminEmail]);
    expect((await verifySignInCode(tenant, adminEmail, lastCodeFor(adminEmail), null)).ok).toBe(false);
  });

  it("accepts a code only once", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const code = lastCodeFor(adminEmail);
    expect((await verifySignInCode(tenant, adminEmail, code, null)).ok).toBe(true);
    expect((await verifySignInCode(tenant, adminEmail, code, null)).ok).toBe(false);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const first = lastCodeFor(adminEmail);
    await requestSignInCode(tenant, adminEmail, null);
    const second = lastCodeFor(adminEmail);
    if (first !== second) expect((await verifySignInCode(tenant, adminEmail, first, null)).ok).toBe(false);
    expect((await verifySignInCode(tenant, adminEmail, second, null)).ok).toBe(true);
  });

  it("stops sending codes after the per-window limit", async () => {
    const { tenant, adminEmail } = await makeTenant();
    for (let i = 0; i < MAX_CODES_PER_WINDOW + 2; i++) await requestSignInCode(tenant, adminEmail, null);
    expect(sentMail.filter((m) => m.to === adminEmail).length).toBe(MAX_CODES_PER_WINDOW);
  });

  it("signs out by revoking the session", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const r = await verifySignInCode(tenant, adminEmail, lastCodeFor(adminEmail), null);
    if (!r.ok) throw new Error("sign-in failed");
    const user = (await userForSession(tenant, r.sessionToken))!;
    await signOut(tenant, user, null);
    expect(await userForSession(tenant, r.sessionToken)).toBeNull();
  });

  it("stops working when the membership is removed", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const r = await verifySignInCode(tenant, adminEmail, lastCodeFor(adminEmail), null);
    if (!r.ok) throw new Error("sign-in failed");
    await query("update membership set status = 'removed' where tenant_id = $1", [tenant.id]);
    expect(await userForSession(tenant, r.sessionToken)).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("a session from one tenant is not valid on another", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await requestSignInCode(a.tenant, a.adminEmail, null);
    const r = await verifySignInCode(a.tenant, a.adminEmail, lastCodeFor(a.adminEmail), null);
    if (!r.ok) throw new Error("sign-in failed");
    expect(await userForSession(a.tenant, r.sessionToken)).not.toBeNull();
    expect(await userForSession(b.tenant, r.sessionToken)).toBeNull();
  });

  it("a code issued on one tenant can't be used on another, even by someone in both", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const shared = `both-${Date.now()}@example.test`;
    await addMember({ tenantId: a.tenantId, email: shared, role: "pm", actorUserId: a.userId });
    await addMember({ tenantId: b.tenantId, email: shared, role: "pm", actorUserId: b.userId });
    await requestSignInCode(a.tenant, shared, null);
    const code = lastCodeFor(shared);
    expect((await verifySignInCode(b.tenant, shared, code, null)).ok).toBe(false);
    expect((await verifySignInCode(a.tenant, shared, code, null)).ok).toBe(true);
  });

  it("stores no sign-in codes or session tokens in readable form", async () => {
    const { tenant, adminEmail } = await makeTenant();
    await requestSignInCode(tenant, adminEmail, null);
    const code = lastCodeFor(adminEmail);
    const r = await verifySignInCode(tenant, adminEmail, code, null);
    if (!r.ok) throw new Error("sign-in failed");
    const codes = await query<{ code_hash: string }>("select code_hash from login_code where email = $1", [adminEmail]);
    expect(codes.every((c) => !c.code_hash.includes(code))).toBe(true);
    const sessions = await query<{ token_hash: string }>("select token_hash from session where tenant_id = $1", [tenant.id]);
    expect(sessions.every((s) => s.token_hash !== r.sessionToken)).toBe(true);
  });
});
