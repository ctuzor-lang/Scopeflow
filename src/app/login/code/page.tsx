import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { currentTenant, currentUser } from "@/lib/request";
import { verifyCodeAction } from "../../actions";

export default async function CodePage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const tenant = await currentTenant();
  if (await currentUser()) redirect("/");
  const { email = "", error } = await searchParams;
  if (!email || tenant.sandbox) redirect("/login");
  return (
    <main className="card-narrow stack">
      <BrandMark tenant={tenant} sub="ScopeFlow" />
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 800 }}>Check your email</h1>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          If <strong style={{ color: "var(--ink)" }}>{email}</strong> has access to this workspace, a code is on its way. It
          expires in {CODE_TTL_MINUTES} minutes.
        </p>
      </div>
      {error ? (
        <p className="note error" role="alert">
          That code didn't work. Check it and try again, or ask for a new one.
        </p>
      ) : null}
      <form action={verifyCodeAction} className="stack">
        <input type="hidden" name="email" value={email} />
        <label>
          Six-digit code
          <input
            type="text"
            name="code"
            className="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
          />
        </label>
        <button type="submit" className="btn accent">
          Sign in
        </button>
      </form>
      <Link href="/login" className="hint">
        Use a different email or get a new code
      </Link>
    </main>
  );
}
