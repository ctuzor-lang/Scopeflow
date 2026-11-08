"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ActionForm";
import { clientRole } from "@/lib/clients";
import { addComment, decideChange } from "@/lib/decisions";
import { clientIp, currentTenant, currentUser } from "@/lib/request";

async function clientContext(projectId: string) {
  const tenant = await currentTenant();
  const user = await currentUser();
  if (!user || user.kind !== "client") return null;
  const role = await clientRole(tenant.id, projectId, user.userId);
  if (!role) return null;
  return { tenant, user, role };
}

const denied: FormState = { status: "error", message: "You don't have access to do that." };

export async function decideAction(
  projectId: string,
  number: number,
  revisionId: string,
  outcome: "approved" | "rejected",
  _prev: FormState,
  f: FormData,
): Promise<FormState> {
  const ctx = await clientContext(projectId);
  if (!ctx) return denied;
  const comment = String(f.get("comment") ?? "").trim().slice(0, 5000) || null;
  const r = await decideChange({
    tenant: ctx.tenant,
    projectId,
    number,
    userId: ctx.user.userId,
    revisionId,
    outcome,
    authorityConfirmed: f.get("authority") === "on",
    shownStatementDigest: String(f.get("statement_digest") ?? ""),
    comment,
    ip: await clientIp(),
    userAgent: (await headers()).get("user-agent"),
  });
  revalidatePath(`/portal/changes/${projectId}/${number}`);
  revalidatePath("/portal");
  if (!r.ok) return { status: "error", message: r.message };
  return { status: "ok", message: outcome === "approved" ? "Approved. Thank you." : "Declined. Thank you." };
}

export async function clientCommentAction(projectId: string, number: number, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await clientContext(projectId);
  if (!ctx) return denied;
  const r = await addComment({ tenant: ctx.tenant, projectId, number, userId: ctx.user.userId, side: "client", body: String(f.get("body") ?? "") });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/portal/changes/${projectId}/${number}`);
  return { status: "ok", message: "Sent. You'll get an email when there's a reply." };
}
