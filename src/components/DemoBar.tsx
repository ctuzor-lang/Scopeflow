import Link from "next/link";
import { endDemoAction, startDemoAction, switchDemoRoleAction } from "@/app/demo/actions";
import { demoGuide, type DemoRole } from "@/lib/demo";
import type { Tenant } from "@/lib/tenant";

/** The guide strip across the top of every demo screen: who you are, what to try next, and a one-click switch. */
export async function DemoBar({ tenant, role }: { tenant: Tenant; role: DemoRole }) {
  if (!tenant.sandbox) return null;
  const step = await demoGuide(tenant.id);
  const other: DemoRole = role === "agency" ? "client" : "agency";
  const sameRole = step && step.role === role;
  return (
    <div className="demobar" role="region" aria-label="Demo guide">
      <div className="wrap">
        <div className="demobar-who">
          <span className="demobar-tag">Demo</span>
          <span>
            Viewing as <strong>{role === "agency" ? "the consultancy" : "the client"}</strong>
          </span>
        </div>
        {step ? (
          <div className="demobar-step">
            <span className="demobar-count">{step.done ? "Done" : `Step ${step.n} of ${step.of}`}</span>
            <span>{step.text}</span>
            {sameRole ? (
              <Link href={step.href} className="demobar-go">
                Go →
              </Link>
            ) : (
              <form action={switchDemoRoleAction.bind(null, step.role, step.href)}>
                <button type="submit" className="demobar-go">
                  Switch to the {step.role === "client" ? "client" : "consultancy"} view →
                </button>
              </form>
            )}
          </div>
        ) : null}
        <div className="demobar-tools">
          {!step || step.role === role ? (
            <form action={switchDemoRoleAction.bind(null, other, other === "client" ? "/portal" : "/")}>
              <button type="submit" className="linkbtn">
                See the {other === "client" ? "client" : "consultancy"} view
              </button>
            </form>
          ) : null}
          <form action={startDemoAction}>
            <button type="submit" className="linkbtn">
              Start over
            </button>
          </form>
          <form action={endDemoAction}>
            <button type="submit" className="linkbtn">
              Exit
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
