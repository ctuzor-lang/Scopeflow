import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { AppShell } from "@/components/AppShell";
import { canManageProjects } from "@/lib/projects";
import { currentTenant, requireUser } from "@/lib/request";
import { createProjectAction } from "../actions";

export default async function NewProjectPage() {
  const tenant = await currentTenant();
  const user = await requireUser();
  return (
    <AppShell tenant={tenant} user={user} current="projects">
      <Link href="/" className="hint">
        ← Projects
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">New project</div>
          <h1>Create a project</h1>
        </div>
      </div>
      {!canManageProjects(user.role) ? (
        <p className="note error">Only admins and project managers can create projects.</p>
      ) : (
        <div className="panel" style={{ maxWidth: 640 }}>
          <ActionForm action={createProjectAction} submitLabel="Create project" pendingLabel="Creating…">
            <label>
              Project name
              <input type="text" name="name" required maxLength={160} placeholder="Order Management Replatform" />
            </label>
            <label>
              Client
              <input type="text" name="clientName" required maxLength={160} placeholder="Northwind Retail" />
            </label>
            <div className="grid-2">
              <label>
                Contract or SOW reference <span className="hint">(optional)</span>
                <input type="text" name="reference" maxLength={60} placeholder="SOW-2026-014" />
              </label>
              <label>
                Currency
                <input type="text" name="currency" defaultValue="GBP" maxLength={3} required pattern="[A-Za-z]{3}" />
              </label>
            </div>
          </ActionForm>
        </div>
      )}
    </AppShell>
  );
}
