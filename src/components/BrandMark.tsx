import { CHAYSE_MARK_PATH, isPlatformTenant } from "@/lib/brandIcon";
import type { Tenant } from "@/lib/tenant";

/** The tenant's logo if it has one, otherwise its initial on the accent colour. */
export function BrandMark({ tenant, sub }: { tenant: Tenant; sub?: string }) {
  const { displayName, hasLogo } = tenant.branding;
  return (
    <span className="brand">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/logo" alt={`${displayName} logo`} />
      ) : isPlatformTenant(tenant) ? (
        <svg className="brand-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect width="32" height="32" rx="6" fill="#1d70f8" />
          <path d={CHAYSE_MARK_PATH} fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      ) : (
        <span className="brand-mark" aria-hidden="true">
          {displayName.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="brand-text">
        <span className="brand-name">{displayName}</span>
        {sub ? <span className="brand-sub">{sub}</span> : null}
      </span>
    </span>
  );
}
