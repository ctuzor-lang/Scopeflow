"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isProduction } from "@/lib/config";
import { createSandbox, demoSession, isDemoUnavailable, SANDBOX_HOURS, type DemoRole } from "@/lib/demo";
import { clearSessionCookie, clientIp, currentTenant, setSessionCookie } from "@/lib/request";
import { DEMO_COOKIE, isDemoHost, requestHost, signDemoCookie } from "@/lib/tenant";

async function requireDemoHost() {
  if (!isDemoHost(requestHost(await headers()))) notFound();
}

/** "Try it yourself": a fresh private sandbox, signed in as its consultant. */
export async function startDemoAction() {
  await requireDemoHost();
  let sandbox;
  try {
    sandbox = await createSandbox(await clientIp());
  } catch (err) {
    if (isDemoUnavailable(err)) redirect("/tour?busy=1");
    throw err;
  }
  (await cookies()).set(DEMO_COOKIE, signDemoCookie(sandbox.tenant.id), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SANDBOX_HOURS * 3600,
  });
  const s = await demoSession(sandbox.tenant, "agency");
  await setSessionCookie(s.token, s.expiresAt);
  redirect(`/projects/${sandbox.projectId}/changes?welcome=1`);
}

/** Flips between the consultancy's view and the client's view of the same sandbox. */
export async function switchDemoRoleAction(role: DemoRole, next: string) {
  await requireDemoHost();
  const tenant = await currentTenant();
  if (!tenant.sandbox) notFound();
  const s = await demoSession(tenant, role);
  await setSessionCookie(s.token, s.expiresAt);
  const safeNext = /^\/[A-Za-z0-9/_?=&-]*$/.test(next) && !next.startsWith("//") ? next : role === "client" ? "/portal" : "/";
  redirect(safeNext);
}

export async function endDemoAction() {
  await requireDemoHost();
  (await cookies()).delete(DEMO_COOKIE);
  await clearSessionCookie();
  redirect("/tour");
}
