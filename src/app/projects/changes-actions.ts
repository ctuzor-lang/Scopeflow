"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ActionForm";
import { getChangeRequest, publishAssessment, raiseChangeRequest, saveImpactDraft, withdrawChange } from "@/lib/changes";
import { inviteClient, revokeClient } from "@/lib/clients";
import { addComment, notifyDecisionNeeded } from "@/lib/decisions";
import { canPublish, getProject } from "@/lib/projects";
import { agencyUser, currentTenant } from "@/lib/request";

const denied: FormState = { status: "error", message: "You don't have access to do that." };

async function context(projectId: string) {
  const tenant = await currentTenant();
  const user = await agencyUser();
  if (!user) return null;
  const project = await getProject(tenant.id, projectId);
  if (!project) return null;
  return { tenant, user, project };
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function raiseChangeAction(projectId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const r = await raiseChangeRequest({
    tenantId: ctx.tenant.id,
    projectId,
    actorUserId: ctx.user.userId,
    input: {
      title: text(f, "title"),
      requestText: text(f, "requestText"),
      source: text(f, "source"),
      requestedBy: text(f, "requestedBy"),
      requestedOn: text(f, "requestedOn"),
      wantedBy: text(f, "wantedBy"),
    },
  });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/changes/${r.number}`);
}

export async function saveAssessmentAction(projectId: string, number: number, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const r = await saveImpactDraft({
    tenantId: ctx.tenant.id,
    projectId,
    number,
    actorUserId: ctx.user.userId,
    input: {
      affectedKeys: f.getAll("affected").map(String),
      scopeChange: text(f, "scopeChange"),
      effortMinDays: text(f, "effortMinDays"),
      effortMaxDays: text(f, "effortMaxDays"),
      price: text(f, "price"),
      pricingBasis: text(f, "pricingBasis"),
      scheduleDays: text(f, "scheduleDays"),
      assumptions: text(f, "assumptions"),
      risks: text(f, "risks"),
    },
  });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}/changes/${number}`);
  return { status: "ok", message: "Assessment saved." };
}

export async function publishAssessmentAction(projectId: string, number: number, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx || !canPublish(ctx.user.role)) return denied;
  if (f.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm the figures are ours to stand behind." };
  const r = await publishAssessment({ tenantId: ctx.tenant.id, projectId, number, actorUserId: ctx.user.userId });
  if (!r.ok) return { status: "error", message: "The assessment isn't ready to send:", details: r.errors };
  const cr = await getChangeRequest(ctx.tenant.id, projectId, number);
  if (cr) await notifyDecisionNeeded(ctx.tenant, projectId, number, cr.title, r.revNo);
  revalidatePath(`/projects/${projectId}`, "layout");
  return { status: "ok", message: `Assessment R${r.revNo} has been sent to the client for a decision.` };
}

export async function withdrawAction(projectId: string, number: number, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx || !canPublish(ctx.user.role)) return denied;
  const r = await withdrawChange({ tenantId: ctx.tenant.id, projectId, number, actorUserId: ctx.user.userId, reason: text(f, "reason") });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}`, "layout");
  return { status: "ok", message: "Change withdrawn." };
}

export async function agencyCommentAction(projectId: string, number: number, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const r = await addComment({ tenant: ctx.tenant, projectId, number, userId: ctx.user.userId, side: "agency", body: text(f, "body") });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}/changes/${number}`);
  return { status: "ok", message: "Reply sent. The client has been emailed." };
}

export async function inviteClientAction(projectId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx || !canPublish(ctx.user.role)) return denied;
  const r = await inviteClient({
    tenant: ctx.tenant,
    projectId,
    actorUserId: ctx.user.userId,
    input: { email: text(f, "email"), name: text(f, "name"), role: text(f, "role") },
  });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}/clients`);
  return { status: "ok", message: `Access given. We've emailed ${text(f, "email").trim()} how to sign in.` };
}

export async function revokeClientAction(projectId: string, accessId: string) {
  const ctx = await context(projectId);
  if (!ctx || !canPublish(ctx.user.role)) return;
  await revokeClient({ tenantId: ctx.tenant.id, projectId, accessId, actorUserId: ctx.user.userId });
  revalidatePath(`/projects/${projectId}/clients`);
}
