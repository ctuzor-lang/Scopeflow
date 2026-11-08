import { config } from "./config";
import { hmac, safeEqualHex } from "./crypto";
import { one } from "./db";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  plan: "pilot" | "agency" | "white_label";
  /** A public-demo sandbox: no real emails, no AI, wiped when it expires. */
  sandbox: boolean;
  branding: {
    displayName: string;
    accentColour: string;
    hasLogo: boolean;
    poweredByVisible: boolean;
  };
};

type Row = {
  id: string;
  slug: string;
  name: string;
  plan: Tenant["plan"];
  display_name: string;
  accent_colour: string;
  logo_key: string | null;
  powered_by_visible: boolean;
  sandbox_expires_at: Date | null;
};

const SELECT = `
  select t.id, t.slug, t.name, t.plan, b.display_name, b.accent_colour, b.logo_key, b.powered_by_visible, t.sandbox_expires_at
  from tenant t join tenant_branding b on b.tenant_id = t.id
  where t.status = 'active' and (t.sandbox_expires_at is null or t.sandbox_expires_at > now())`;

function toTenant(r: Row): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    plan: r.plan,
    sandbox: r.sandbox_expires_at !== null,
    branding: {
      displayName: r.display_name,
      accentColour: r.accent_colour,
      hasLogo: r.logo_key !== null,
      // Only the white-label plan may hide the platform credit.
      poweredByVisible: r.plan === "white_label" ? r.powered_by_visible : true,
    },
  };
}

/** Lower-cases the host and strips any port. Returns null for anything that isn't a plausible hostname. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
}

/**
 * Picks the host the visitor actually typed. X-Forwarded-Host is trusted only
 * when TRUST_PROXY=true, i.e. when a known proxy in front of the app sets it.
 */
export function requestHost(headers: { get(name: string): string | null }): string | null {
  const forwarded = config().TRUST_PROXY === "true" ? headers.get("x-forwarded-host") : null;
  return normaliseHost(forwarded ?? headers.get("host"));
}

/**
 * Resolves which tenant a request belongs to, from the address it was made to.
 * Only verified domains count. In development an unknown host falls back to
 * DEV_TENANT_SLUG (config refuses that setting in production).
 */
export async function resolveTenant(host: string | null): Promise<Tenant | null> {
  if (host) {
    const row = await one<Row>(
      `${SELECT} and t.sandbox_expires_at is null
         and t.id = (select tenant_id from tenant_domain where hostname = $1 and verified_at is not null)`,
      [host],
    );
    if (row) return toTenant(row);
  }
  const devSlug = config().DEV_TENANT_SLUG;
  if (devSlug) {
    const row = await one<Row>(`${SELECT} and t.slug = $1`, [devSlug]);
    if (row) return toTenant(row);
  }
  return null;
}

export async function tenantLogoKey(tenantId: string): Promise<string | null> {
  const row = await one<{ logo_key: string | null }>("select logo_key from tenant_branding where tenant_id = $1", [
    tenantId,
  ]);
  return row?.logo_key ?? null;
}

// ---------- public demo sandboxes ----------

export const DEMO_COOKIE = "sf_demo";

export const isDemoHost = (host: string | null) => !!host && !!config().DEMO_HOSTNAME && host === config().DEMO_HOSTNAME;

/** The demo cookie names a sandbox and carries a signature, so a visitor can't point it at someone else's workspace. */
export const signDemoCookie = (tenantId: string) => `${tenantId}.${hmac(config().SECRET_KEY, `demo:${tenantId}`)}`;

export async function sandboxFromCookie(value: string | undefined | null): Promise<Tenant | null> {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id) || !safeEqualHex(sig, hmac(config().SECRET_KEY, `demo:${id}`))) return null;
  const row = await one<Row>(`${SELECT} and t.sandbox_expires_at is not null and t.id = $1`, [id]);
  return row ? toTenant(row) : null;
}

/**
 * The tenant for a request. On the demo address it's the visitor's own sandbox (from a signed cookie);
 * everywhere else it's decided by the verified address alone.
 */
export async function tenantForRequest(
  headers: { get(name: string): string | null },
  cookie: (name: string) => string | undefined,
): Promise<Tenant | null> {
  const host = requestHost(headers);
  if (isDemoHost(host)) return sandboxFromCookie(cookie(DEMO_COOKIE));
  return resolveTenant(host);
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const row = await one<Row>(`${SELECT} and t.id = $1`, [id]);
  return row ? toTenant(row) : null;
}
