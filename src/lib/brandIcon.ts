import { config } from "./config";
import type { Tenant } from "./tenant";

/** The Chayse mark, as on chayse.com: a "C" arc on a rounded square. */
export const CHAYSE_MARK_PATH = "M22 11.5A7.5 7.5 0 1 0 22 20.5";

export const isPlatformTenant = (tenant: Pick<Tenant, "slug"> | null) => !!tenant && tenant.slug === config().PLATFORM_TENANT_SLUG;

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/**
 * The tab icon. Chayse (the platform owner) gets its own mark; every other workspace gets its
 * initial on its accent colour, so white-label clients never see Chayse's branding.
 */
export function brandIconSvg(tenant: Tenant | null): string {
  if (!tenant || isPlatformTenant(tenant)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1d70f8"/><path d="${CHAYSE_MARK_PATH}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>`;
  }
  const accent = /^#[0-9a-f]{6}$/i.test(tenant.branding.accentColour) ? tenant.branding.accentColour : "#1b68ea";
  const letter = escapeXml(tenant.branding.displayName.trim().charAt(0).toUpperCase() || "S");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${accent}"/><text x="16" y="22.5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="19" fill="#fff">${letter}</text></svg>`;
}
