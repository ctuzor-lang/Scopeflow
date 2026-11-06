import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { currentTenant, requireUser } from "@/lib/request";
import { requestHost } from "@/lib/tenant";
import { BrandingForm } from "./BrandingForm";

export default async function BrandingPage() {
  const tenant = await currentTenant();
  const user = await requireUser();
  const host = requestHost(await headers()) ?? "";

  return (
    <AppShell tenant={tenant} user={user} current="branding">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace settings</div>
          <h1>Branding</h1>
          <p className="muted" style={{ margin: "8px 0 0", maxWidth: "62ch" }}>
            Everything your clients see, from sign-in to approvals and change notes, carries your name, colour and logo.
          </p>
        </div>
      </div>
      {user.role !== "admin" ? (
        <p className="note error">Only workspace admins can change branding. Ask an admin if something needs updating.</p>
      ) : (
        <BrandingForm
          displayName={tenant.branding.displayName}
          accentColour={tenant.branding.accentColour}
          poweredByVisible={tenant.branding.poweredByVisible}
          canHidePoweredBy={tenant.plan === "white_label"}
          hasLogo={tenant.branding.hasLogo}
          hostname={host}
        />
      )}
    </AppShell>
  );
}
