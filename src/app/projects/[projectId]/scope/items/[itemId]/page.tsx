import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ItemFields } from "@/components/ItemFields";
import { currentTenant, requireUser } from "@/lib/request";
import { getDraftItem } from "@/lib/scope";
import { editItemAction } from "../../../../actions";

export default async function EditItemPage({ params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  const { projectId, itemId } = await params;
  const tenant = await currentTenant();
  await requireUser();
  const item = await getDraftItem(tenant.id, projectId, itemId);
  if (!item) notFound();
  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <div className="stack" style={{ marginBottom: 16 }}>
        <Link href={`/projects/${projectId}/scope`} className="hint">
          ← Back to the draft
        </Link>
        <h2 style={{ fontSize: 24, fontWeight: 700 }}>
          Edit <span className="mono">{item.key}</span>
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          Saving creates revision {item.revNo + 1} of this item in the draft. Published versions keep the wording they were
          published with.
        </p>
      </div>
      <ActionForm action={editItemAction.bind(null, projectId, itemId)} submitLabel="Save changes" pendingLabel="Saving…">
        <ItemFields item={item} keyLocked />
      </ActionForm>
    </div>
  );
}
