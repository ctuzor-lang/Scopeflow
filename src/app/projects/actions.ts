"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ActionForm";
import { publishBaseline } from "@/lib/baselines";
import { parseScopeFile } from "@/lib/importer";
import { canManageProjects, canPublish, createProject, getProject } from "@/lib/projects";
import { currentTenant, currentUser } from "@/lib/request";
import { importRows, removeItem, saveItem } from "@/lib/scope";

async function context(projectId?: string) {
  const tenant = await currentTenant();
  const user = await currentUser();
  if (!user) return null;
  if (!projectId) return { tenant, user, project: null };
  const project = await getProject(tenant.id, projectId);
  if (!project) return null;
  return { tenant, user, project };
}

const denied: FormState = { status: "error", message: "You don't have access to do that." };

export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (!ctx || !canManageProjects(ctx.user.role)) return denied;
  const result = await createProject({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.userId,
    input: {
      name: String(formData.get("name") ?? ""),
      clientName: String(formData.get("clientName") ?? ""),
      reference: String(formData.get("reference") ?? ""),
      currency: String(formData.get("currency") ?? "GBP"),
    },
  });
  if (!result.ok) return { status: "error", message: result.error };
  redirect(`/projects/${result.projectId}/scope`);
}

export async function importScopeAction(projectId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a spreadsheet to import." };
  const parsed = await parseScopeFile(file.name, Buffer.from(await file.arrayBuffer()));
  if (!parsed.ok) {
    return { status: "error", message: "Nothing was imported. Fix these and try again:", details: parsed.errors };
  }
  const s = await importRows({
    tenantId: ctx.tenant.id,
    projectId,
    actorUserId: ctx.user.userId,
    rows: parsed.rows,
    fileName: file.name,
  });
  revalidatePath(`/projects/${projectId}/scope`);
  const parts = [
    `${s.added} added`,
    s.updated ? `${s.updated} updated` : null,
    s.restored ? `${s.restored} restored` : null,
    s.unchanged ? `${s.unchanged} unchanged` : null,
  ].filter(Boolean);
  return { status: "ok", message: `Imported ${parsed.rows.length} rows into the draft: ${parts.join(", ")}.` };
}

function itemFields(formData: FormData) {
  return {
    key: String(formData.get("key") ?? ""),
    kind: String(formData.get("kind") ?? "requirement"),
    section: String(formData.get("section") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
  };
}

export async function addItemAction(projectId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const r = await saveItem({ tenantId: ctx.tenant.id, projectId, actorUserId: ctx.user.userId, input: itemFields(formData) });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}/scope`);
  return { status: "ok", message: `Added ${r.key} to the draft.` };
}

export async function editItemAction(projectId: string, itemId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx) return denied;
  const r = await saveItem({
    tenantId: ctx.tenant.id,
    projectId,
    itemId,
    actorUserId: ctx.user.userId,
    input: itemFields(formData),
  });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}/scope`);
  redirect(`/projects/${projectId}/scope`);
}

export async function removeItemAction(projectId: string, itemId: string) {
  const ctx = await context(projectId);
  if (!ctx) return;
  await removeItem({ tenantId: ctx.tenant.id, projectId, itemId, actorUserId: ctx.user.userId });
  revalidatePath(`/projects/${projectId}/scope`);
}

export async function publishAction(projectId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context(projectId);
  if (!ctx || !canPublish(ctx.user.role)) return denied;
  if (formData.get("confirm") !== "on") {
    return { status: "error", message: "Tick the box to confirm the draft is ready to publish." };
  }
  const r = await publishBaseline({ tenantId: ctx.tenant.id, projectId, actorUserId: ctx.user.userId });
  if (!r.ok) return { status: "error", message: r.error };
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/versions/${r.version}`);
}
