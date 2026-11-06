"use server";

import { redirect } from "next/navigation";
import { requestSignInCode, signOut, verifySignInCode } from "@/lib/auth";
import { clearSessionCookie, clientIp, currentTenant, currentUser, setSessionCookie } from "@/lib/request";

export async function requestCodeAction(formData: FormData) {
  const tenant = await currentTenant();
  const email = String(formData.get("email") ?? "").slice(0, 254);
  await requestSignInCode(tenant, email, await clientIp());
  // Same response whether or not the address is a member.
  redirect(`/login/code?email=${encodeURIComponent(email.trim().toLowerCase())}`);
}

export async function verifyCodeAction(formData: FormData) {
  const tenant = await currentTenant();
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const code = String(formData.get("code") ?? "").slice(0, 20);
  const result = await verifySignInCode(tenant, email, code, await clientIp());
  if (!result.ok) redirect(`/login/code?email=${encodeURIComponent(email)}&error=1`);
  await setSessionCookie(result.sessionToken, result.expiresAt);
  redirect("/");
}

export async function signOutAction() {
  const tenant = await currentTenant();
  const user = await currentUser();
  if (user) await signOut(tenant, user, await clientIp());
  await clearSessionCookie();
  redirect("/login");
}
