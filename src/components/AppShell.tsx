import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import type { Tenant } from "@/lib/tenant";
import { signOutAction } from "@/app/actions";
import { BrandMark } from "./BrandMark";
import { DemoBar } from "./DemoBar";

type Section = "projects" | "branding";

export function AppShell({
  tenant,
  user,
  current,
  children,
}: {
  tenant: Tenant;
  user: CurrentUser;
  current: Section;
  children: ReactNode;
}) {
  return (
    <>
      <DemoBar tenant={tenant} role="agency" />
      <header className="topbar">
        <div className="wrap">
          <Link href="/" style={{ textDecoration: "none", marginRight: "auto" }} aria-label={`${tenant.branding.displayName} workspace home`}>
            <BrandMark tenant={tenant} sub="ScopeFlow workspace" />
          </Link>
          <nav className="nav" aria-label="Workspace">
            <Link href="/" aria-current={current === "projects" ? "page" : undefined}>
              Projects
            </Link>
            {user.role === "admin" ? (
              <Link href="/settings/branding" aria-current={current === "branding" ? "page" : undefined}>
                Settings
              </Link>
            ) : null}
          </nav>
          <div className="who">
            <span className="muted">{user.displayName ?? user.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="linkbtn">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="wrap page">
        {children}
      </main>
      <footer className="footer">
        <div className="wrap">
          <span>{tenant.branding.displayName}</span>
          {tenant.branding.poweredByVisible ? <span>Powered by ScopeFlow</span> : null}
        </div>
      </footer>
    </>
  );
}
