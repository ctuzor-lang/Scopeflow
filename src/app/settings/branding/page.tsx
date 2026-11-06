import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { currentTenant, requireUser } from "@/lib/request";
import { requestHost } from "@/lib/tenant";
import { BrandingForm } from "./BrandingForm";
import { aiConfigured, aiEnabledForTenant } from "@/lib/ai";
import { toggleAiAction } from "./actions";

export default async function BrandingPage() {
  const tenant = await currentTenant();
  const user = await requireUser();
  const host = requestHost(await headers()) ?? "";

  return (
    <AppShell tenant={tenant} user={user} current="branding">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace settings</div>
          <h1>Settings</h1>
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
      {user.role === "admin" ? (
        <section className="panel stack" style={{ marginTop: 36, maxWidth: 720 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>AI suggestions</h2>
          <p className="muted" style={{ margin: 0 }}>
            When assessing a change, your team can ask AI to suggest which agreed items are affected, risks, assumptions and
            questions for the client. Suggestions are advisory; nothing changes until someone accepts one, and AI never sets
            prices. The change request text and agreed scope items are sent to Anthropic for this; prices, names and email
            addresses are not.
          </p>
          {!aiConfigured() ? (
            <p className="note">AI isn&apos;t available on this server yet (no API key configured).</p>
          ) : (await aiEnabledForTenant(tenant.id)) ? (
            <form action={toggleAiAction.bind(null, false)} className="stack">
              <p className="note ok" style={{ margin: 0 }}>AI suggestions are on for this workspace.</p>
              <div><button type="submit" className="btn">Turn off</button></div>
            </form>
          ) : (
            <form action={toggleAiAction.bind(null, true)} className="stack">
              <p style={{ margin: 0 }}><strong>Off.</strong> Check your client contracts allow this processing before turning it on.</p>
              <div><button type="submit" className="btn solid">Turn on AI suggestions</button></div>
            </form>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
