import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { currentTenant, currentUser } from "@/lib/request";
import { requestCodeAction } from "../actions";
import { endDemoAction, switchDemoRoleAction } from "../demo/actions";

export default async function LoginPage() {
  const tenant = await currentTenant();
  if (await currentUser()) redirect("/");
  if (tenant.sandbox) {
    return (
      <main className="card-narrow stack">
        <BrandMark tenant={tenant} sub="ScopeFlow demo" />
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 800 }}>Pick a view</h1>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            In the real product people sign in with a one-time code sent to their email. In the demo, just choose who to be.
          </p>
        </div>
        <form action={switchDemoRoleAction.bind(null, "agency", "/")}>
          <button type="submit" className="btn accent" style={{ width: "100%" }}>
            The consultancy (Alex)
          </button>
        </form>
        <form action={switchDemoRoleAction.bind(null, "client", "/portal")}>
          <button type="submit" className="btn" style={{ width: "100%" }}>
            The client (Sam at Northwind)
          </button>
        </form>
        <form action={endDemoAction}>
          <button type="submit" className="linkbtn">Leave the demo</button>
        </form>
      </main>
    );
  }
  return (
    <main className="card-narrow stack">
      <BrandMark tenant={tenant} sub="ScopeFlow" />
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 800 }}>Sign in</h1>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          We'll email you a six-digit code. No password needed.
        </p>
      </div>
      <form action={requestCodeAction} className="stack">
        <label>
          Work email
          <input type="email" name="email" required autoComplete="email" inputMode="email" maxLength={254} />
        </label>
        <button type="submit" className="btn accent">
          Email me a code
        </button>
      </form>
      {tenant.branding.poweredByVisible ? <p className="hint">Powered by ScopeFlow</p> : null}
    </main>
  );
}
