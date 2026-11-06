import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/lib/audit";
import { contrastRatio, saveBranding, saveLogo } from "../src/lib/branding";
import { pool, query } from "../src/lib/db";
import { resolveTenant } from "../src/lib/tenant";
import { makeTenant } from "./helpers";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe("branding", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#1b68ea", "#ffffff")).toBeGreaterThan(4.5);
  });

  it("saves a valid name and colour", async () => {
    const { tenant, hostname, userId } = await makeTenant();
    const r = await saveBranding({
      tenantId: tenant.id,
      plan: tenant.plan,
      actorUserId: userId,
      input: { displayName: "Harbour Digital", accentColour: "#0F766E", poweredByVisible: true },
    });
    expect(r.ok).toBe(true);
    const after = await resolveTenant(hostname);
    expect(after?.branding).toMatchObject({ displayName: "Harbour Digital", accentColour: "#0f766e" });
  });

  it("rejects a colour too light for white button text", async () => {
    const { tenant, userId } = await makeTenant();
    const r = await saveBranding({
      tenantId: tenant.id,
      plan: tenant.plan,
      actorUserId: userId,
      input: { displayName: "X", accentColour: "#ffd700", poweredByVisible: true },
    });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("too light") });
  });

  it("only lets the white-label plan hide the platform credit", async () => {
    const pilot = await makeTenant({ plan: "pilot" });
    await saveBranding({
      tenantId: pilot.tenant.id,
      plan: "pilot",
      actorUserId: pilot.userId,
      input: { displayName: "P", accentColour: "#1b68ea", poweredByVisible: false },
    });
    expect((await resolveTenant(pilot.hostname))?.branding.poweredByVisible).toBe(true);

    const wl = await makeTenant({ plan: "white_label" });
    await saveBranding({
      tenantId: wl.tenant.id,
      plan: "white_label",
      actorUserId: wl.userId,
      input: { displayName: "W", accentColour: "#1b68ea", poweredByVisible: false },
    });
    expect((await resolveTenant(wl.hostname))?.branding.poweredByVisible).toBe(false);
  });

  it("accepts a PNG logo and refuses SVG, unknown and oversized files", async () => {
    const { tenant, userId, hostname } = await makeTenant();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await saveLogo({ tenantId: tenant.id, actorUserId: userId, data: svg })).ok).toBe(false);
    expect((await saveLogo({ tenantId: tenant.id, actorUserId: userId, data: Buffer.from("hello") })).ok).toBe(false);
    const huge = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    expect((await saveLogo({ tenantId: tenant.id, actorUserId: userId, data: huge })).ok).toBe(false);
    expect((await saveLogo({ tenantId: tenant.id, actorUserId: userId, data: PNG })).ok).toBe(true);
    expect((await resolveTenant(hostname))?.branding.hasLogo).toBe(true);
  });
});

describe("audit trail", () => {
  it("records actions in an intact chain", async () => {
    const { tenant, userId } = await makeTenant();
    await saveBranding({
      tenantId: tenant.id,
      plan: tenant.plan,
      actorUserId: userId,
      input: { displayName: "Chain Co", accentColour: "#1b68ea", poweredByVisible: true },
    });
    const events = await query<{ action: string }>("select action from audit_event where tenant_id = $1 order by id", [tenant.id]);
    expect(events.map((e) => e.action)).toEqual(["tenant.created", "branding.updated"]);
    const client = await pool().connect();
    try {
      expect(await verifyAuditChain(client, tenant.id)).toBeNull();
    } finally {
      client.release();
    }
  });

  it("refuses edits and deletions of audit events", async () => {
    const { tenant } = await makeTenant();
    await expect(query("update audit_event set action = 'x' where tenant_id = $1", [tenant.id])).rejects.toThrow(/append-only/);
    await expect(query("delete from audit_event where tenant_id = $1", [tenant.id])).rejects.toThrow(/append-only/);
  });

  it("detects an event inserted outside the application", async () => {
    const { tenant } = await makeTenant();
    await query(
      "insert into audit_event (tenant_id, action, prev_digest, event_digest) values ($1, 'forged', null, 'deadbeef')",
      [tenant.id],
    );
    const client = await pool().connect();
    try {
      expect(await verifyAuditChain(client, tenant.id)).not.toBeNull();
    } finally {
      client.release();
    }
  });
});
