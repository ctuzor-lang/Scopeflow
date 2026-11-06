"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; details?: string[] };

export const idle: FormState = { status: "idle" };

/** A form bound to a server action that reports success or problems inline. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  className = "stack",
  resetOnSuccess = false,
  buttonClass = "btn solid",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  buttonClass?: string;
}) {
  const [state, run, pending] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.status === "ok") ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      {state.status === "error" ? (
        <div className="note error" role="alert">
          {state.message}
          {state.details?.length ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {state.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {state.status === "ok" ? (
        <p className="note ok" role="status">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? (pendingLabel ?? "Working…") : submitLabel}
        </button>
      </div>
    </form>
  );
}
