import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, userForSession } from "@/lib/auth";
import { changeNoteData, noteFileName, renderChangeNote } from "@/lib/changeNote";
import { clientRole } from "@/lib/clients";
import { tenantForRequest } from "@/lib/tenant";

/** The change control note for client people with access to this project. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string; number: string }> }) {
  const { projectId, number } = await params;
  const tenant = await tenantForRequest(request.headers, (name) => request.cookies.get(name)?.value);
  if (!tenant) return new Response("Not found", { status: 404 });
  const user = await userForSession(tenant, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user || user.kind !== "client" || !(await clientRole(tenant.id, projectId, user.userId))) {
    return new Response("Not found", { status: 404 });
  }
  const data = await changeNoteData(tenant, projectId, Number(number));
  if (!data) return new Response("Not found", { status: 404 });
  const pdf = await renderChangeNote(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${noteFileName(data)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
