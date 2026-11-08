import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ProjectTabs } from "@/components/ProjectTabs";
import { ProjectJourney } from "@/components/ProjectJourney";
import { getProject, projectProgress } from "@/lib/projects";
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
  const progress = await projectProgress(tenant.id, projectId);
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
      <ProjectJourney projectId={project.id} p={progress} clientName={project.clientName} />
      <ProjectTabs projectId={project.id} versionCount={progress.versions} changeCount={progress.changes} />
      {children}
    </AppShell>
  );
}
