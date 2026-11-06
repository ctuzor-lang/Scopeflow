import type { Tenant } from "@/lib/tenant";

/** The tenant's logo if it has one, otherwise its initial on the accent colour. */
export function BrandMark({ tenant, sub }: { tenant: Tenant; sub?: string }) {
  const { displayName, hasLogo } = tenant.branding;
  return (
    <span className="brand">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/logo" alt={`${displayName} logo`} />
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
