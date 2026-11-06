"use server";

import { revalidatePath } from "next/cache";
import { setAiEnabled } from "@/lib/ai";
import { saveBranding, saveLogo } from "@/lib/branding";
import { agencyUser, clientIp, currentTenant } from "@/lib/request";

export type FormState = { status: "idle" } | { status: "ok"; message: string } | { status: "error"; message: string };

async function requireAdmin() {
  const tenant = await currentTenant();
  const user = await agencyUser();
  if (!user || user.role !== "admin") return null;
  return { tenant, user };
}

export async function saveBrandingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  if (!ctx) return { status: "error", message: "Only workspace admins can change branding." };
  const result = await saveBranding({
    tenantId: ctx.tenant.id,
    plan: ctx.tenant.plan,
    actorUserId: ctx.user.userId,
    ip: await clientIp(),
    input: {
      displayName: String(formData.get("displayName") ?? ""),
      accentColour: String(formData.get("accentColour") ?? ""),
      poweredByVisible: formData.get("poweredByVisible") === "on",
    },
  });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/", "layout");
  return { status: "ok", message: "Branding saved." };
}

export async function uploadLogoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  if (!ctx) return { status: "error", message: "Only workspace admins can change branding." };
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a logo file to upload." };
  const result = await saveLogo({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.userId,
    ip: await clientIp(),
    data: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/", "layout");
  return { status: "ok", message: "Logo uploaded." };
}

export async function toggleAiAction(enable: boolean) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  await setAiEnabled(ctx.tenant.id, ctx.user.userId, enable);
  revalidatePath("/settings/branding");
}
