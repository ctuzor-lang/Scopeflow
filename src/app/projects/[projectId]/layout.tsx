import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ProjectTabs } from "@/components/ProjectTabs";
import { listBaselines } from "@/lib/baselines";
import { query } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { currentTenant, requireUser } from "@/lib/request";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const tenant = await currentTenant();
  const user = await requireUser();
  const project = await getProject(tenant.id, projectId);
  if (!project) notFound();
  const [versions, changes] = await Promise.all([
    listBaselines(tenant.id, projectId),
    query<{ n: string }>("select count(*) as n from change_request where project_id = $1 and tenant_id = $2", [projectId, tenant.id]),
  ]);
  return (
    <AppShell tenant={tenant} user={user} current="projects">
      <Link href="/" className="hint">
        ← Projects
      </Link>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <div className="eyebrow">
            {project.clientName}
            {project.reference ? ` · ${project.reference}` : ""}
          </div>
          <h1>{project.name}</h1>
        </div>
      </div>
      <ProjectTabs projectId={project.id} versionCount={versions.length} changeCount={Number(changes[0]?.n ?? 0)} />
      {children}
    </AppShell>
  );
}
