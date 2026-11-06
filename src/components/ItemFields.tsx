import type { DraftItem } from "@/lib/scope";

const KIND_LABELS = [
  ["requirement", "Requirement"],
  ["deliverable", "Deliverable"],
  ["assumption", "Assumption"],
  ["exclusion", "Exclusion (out of scope)"],
] as const;

export const kindLabel = (k: string) => KIND_LABELS.find(([v]) => v === k)?.[1].replace(" (out of scope)", "") ?? k;

/** Shared fields for adding or editing a scope item. */
export function ItemFields({ item, keyLocked = false }: { item?: DraftItem; keyLocked?: boolean }) {
  return (
    <>
      <div className="grid-2">
        <label>
          Reference
          <input
            type="text"
            name="key"
            defaultValue={item?.key ?? ""}
            maxLength={32}
            readOnly={keyLocked}
            placeholder="e.g. CP-03 (leave blank to number it)"
            style={{ fontFamily: "var(--mono)" }}
          />
          {keyLocked ? <span className="hint">References stay fixed so changes can be traced.</span> : null}
        </label>
        <label>
          Type
          <select name="kind" defaultValue={item?.kind ?? "requirement"}>
            {KIND_LABELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Section <span className="hint">(optional)</span>
        <input type="text" name="section" defaultValue={item?.section ?? ""} maxLength={120} placeholder="Checkout & payments" />
      </label>
      <label>
        Title
        <input type="text" name="title" defaultValue={item?.title ?? ""} required maxLength={300} />
      </label>
      <label>
        Description <span className="hint">(optional)</span>
        <textarea name="description" defaultValue={item?.description ?? ""} maxLength={5000} />
      </label>
      <label>
        Acceptance criteria <span className="hint">(optional)</span>
        <textarea name="acceptanceCriteria" defaultValue={item?.acceptanceCriteria ?? ""} maxLength={5000} />
      </label>
    </>
  );
}
