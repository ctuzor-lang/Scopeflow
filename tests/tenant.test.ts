import { describe, expect, it } from "vitest";
import { normaliseHost, resolveTenant } from "../src/lib/tenant";
import { makeTenant } from "./helpers";

describe("tenant resolution", () => {
  it("normalises hosts and rejects junk", () => {
    expect(normaliseHost("App.Chayse.com:443")).toBe("app.chayse.com");
    expect(normaliseHost("a.example, b.example")).toBe("a.example");
    expect(normaliseHost("evil host/../")).toBeNull();
    expect(normaliseHost("")).toBeNull();
  });

  it("resolves a verified domain to its tenant", async () => {
    const { tenantId, hostname } = await makeTenant();
    const tenant = await resolveTenant(hostname);
    expect(tenant?.id).toBe(tenantId);
  });

  it("ignores an unverified domain", async () => {
    const { hostname } = await makeTenant({ verified: false });
    expect(await resolveTenant(hostname)).toBeNull();
  });

  it("returns nothing for an unknown address when no dev fallback is set", async () => {
    expect(await resolveTenant("nobody.example.test")).toBeNull();
  });
});
