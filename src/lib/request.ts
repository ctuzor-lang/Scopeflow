import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, userForSession, type CurrentUser } from "./auth";
import { config, isProduction } from "./config";
import { requestHost, resolveTenant, type Tenant } from "./tenant";

/** The tenant for this request, from the address it was made to. Unknown addresses get a 404. */
export const currentTenant = cache(async (): Promise<Tenant> => {
  const tenant = await resolveTenant(requestHost(await headers()));
  if (!tenant) notFound();
  return tenant;
});

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const tenant = await currentTenant();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForSession(tenant, token);
});

export type AgencyUser = Extract<CurrentUser, { kind: "agency" }>;
export type ClientUser = Extract<CurrentUser, { kind: "client" }>;

/** For agency screens. Client people are sent to their portal. */
export async function requireUser(): Promise<AgencyUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.kind !== "agency") redirect("/portal");
  return user;
}

/** For server actions on agency data: null unless an agency member is signed in. */
export async function agencyUser(): Promise<AgencyUser | null> {
  const user = await currentUser();
  return user && user.kind === "agency" ? user : null;
}

/** For the client portal. Agency people are sent to their workspace. */
export async function requireClient(): Promise<ClientUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.kind !== "client") redirect("/");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = config().TRUST_PROXY === "true" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  return forwarded || h.get("x-real-ip") || null;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    // No domain attribute: the cookie stays on the exact tenant address that issued it.
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
