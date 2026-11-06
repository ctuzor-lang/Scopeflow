import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { currentTenant, currentUser } from "@/lib/request";
import { requestCodeAction } from "../actions";

export default async function LoginPage() {
  const tenant = await currentTenant();
  if (await currentUser()) redirect("/");
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
