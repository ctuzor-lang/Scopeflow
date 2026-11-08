import Link from "next/link";
import type { ReactNode } from "react";
import type { Tenant } from "@/lib/tenant";
import { signOutAction } from "@/app/actions";
import { BrandMark } from "./BrandMark";
import { DemoBar } from "./DemoBar";

/** The client-facing frame: the agency's brand only, no workspace navigation. */
export function PortalShell({ tenant, who, children }: { tenant: Tenant; who: string; children: ReactNode }) {
  return (
    <>
      <DemoBar tenant={tenant} role="client" />
      <header className="topbar">
        <div className="wrap">
          <Link href="/portal" style={{ textDecoration: "none", marginRight: "auto" }} aria-label="Your decisions">
            <BrandMark tenant={tenant} />
          </Link>
          <div className="who">
            <span className="muted">{who}</span>
            <form action={signOutAction}>
              <button type="submit" className="linkbtn">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="wrap page" style={{ maxWidth: 760 }}>
        {children}
      </main>
      <footer className="footer">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <span>{tenant.branding.displayName}</span>
          {tenant.branding.poweredByVisible ? <span>Powered by ScopeFlow</span> : null}
        </div>
      </footer>
    </>
  );
}
